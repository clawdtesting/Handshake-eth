// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";

/// @title Handshake
/// @notice Atomic peer-to-peer settlement of off-chain signed NFT/ETH trade
///         orders on Ethereum. Orders are EIP-712 signed by the maker, stored
///         off-chain (zero gas to create), and settled on-chain by the taker.
///
///         Supported shapes: NFT↔NFT, NFT↔ETH, ETH↔NFT, NFT+ETH↔NFT(+ETH).
///
///         Maker-side ETH is funded from the maker's self-managed escrow
///         balance (deposit/withdraw — the contract owner can never move
///         user funds). Taker-side ETH is provided as msg.value.
///
///         ETH proceeds are auto-withdrawn: settlement sends them directly with a
///         bounded gas stipend so no second transaction is needed. If a recipient
///         can't receive within that budget (reverts / gas-heavy / non-payable),
///         the amount safely falls back to an escrow credit it can pull later, so
///         a hostile counterparty can never grief or OOG the trade. Protocol fees
///         are always pull payments (pendingFees + withdrawFees).
contract Handshake is EIP712, ReentrancyGuard, Pausable, Ownable2Step {
    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    struct NFTItem {
        uint8 standard;
        address contractAddress;
        uint256 tokenId;
        uint256 amount;
    }

    struct TradeOrder {
        address maker;
        address taker; // address(0) => open to anyone
        NFTItem[] makerNFTs;
        NFTItem[] takerNFTs;
        uint256 makerEthAmount;
        uint256 takerEthAmount;
        uint256 feeBps; // fee on each ETH leg, agreed at signing time
        uint256 flatFee; // flat fee (wei) for NFT-only swaps, agreed at signing
        uint256 nonce;
        uint256 expiry; // unix timestamp
    }

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    bytes32 public constant NFT_ITEM_TYPEHASH =
        keccak256("NFTItem(uint8 standard,address contractAddress,uint256 tokenId,uint256 amount)");

    bytes32 public constant TRADE_ORDER_TYPEHASH = keccak256(
        "TradeOrder(address maker,address taker,NFTItem[] makerNFTs,NFTItem[] takerNFTs,uint256 makerEthAmount,uint256 takerEthAmount,uint256 feeBps,uint256 flatFee,uint256 nonce,uint256 expiry)NFTItem(uint8 standard,address contractAddress,uint256 tokenId,uint256 amount)"
    );

    /// @notice EIP-712 type for a maker-authorized nonce cancellation, so an
    ///         EIP-1271 wallet maker that cannot call the contract directly can
    ///         still revoke a resting order via a relayed signed message.
    bytes32 public constant CANCEL_TYPEHASH =
        keccak256("Cancel(address maker,uint256 nonce)");

    uint256 public constant MAX_FEE_BPS = 500; // 5%
    uint256 public constant MAX_FLAT_SWAP_FEE = 1 ether; // hard cap on flat swap fee
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant MAX_ITEMS_PER_SIDE = 20;

    /// @notice Gas forwarded to an auto-withdraw ETH payout. Bounded so a hostile
    ///         recipient can't burn gas / OOG the settlement tail; if the payout
    ///         needs more than this (or reverts), it safely falls back to an
    ///         escrow credit the recipient can pull later. Generous enough for
    ///         EOAs and simple smart wallets to receive directly.
    uint256 public constant PAYOUT_GAS_STIPEND = 30_000;

    /// @notice Timelock applied to *adding* a collection to the tradable
    ///         allowlist. Removals are instant (see removeCollection). This
    ///         asymmetry bounds a compromised owner key: it cannot whitelist a
    ///         malicious collection and drain in the same block — the collection
    ///         sits publicly pending for this window, during which anyone
    ///         watching CollectionProposed can react and the owner (or a fresh
    ///         key after recovery) can remove it instantly.
    uint256 public constant ADD_DELAY = 48 hours;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    address public feeRecipient;
    uint256 public feeBps; // fee on each ETH leg, default 100 = 1%
    uint256 public flatSwapFee; // flat fee (in wei) charged on NFT-only swaps

    /// @notice maker => nonce => consumed (filled or cancelled)
    mapping(address => mapping(uint256 => bool)) public nonceUsed;

    /// @notice Self-managed ETH escrow used to fund maker-side ETH legs.
    mapping(address => uint256) public escrowBalance;

    /// @notice Pull-payment ledger of protocol fees owed to fee recipients.
    ///         Accrued during settlement; claimed via withdrawFees(). Pull
    ///         payments stop a reverting fee recipient from bricking trades.
    mapping(address => uint256) public pendingFees;
    mapping(address => uint256) public pendingRoyalties;

    /// @notice Collection allowlist: contract address => unix time at which it
    ///         becomes tradable. 0 means the collection is not allowed. A trade
    ///         may only touch a collection whose timestamp is set and has
    ///         elapsed (see _isAllowedCollection), so a maliciously-lying
    ///         `ownerOf` is excluded before it is ever called. Adds are
    ///         timelocked by ADD_DELAY; removals set the entry back to 0
    ///         instantly.
    mapping(address => uint256) public collectionAllowedAt;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event TradeExecuted(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        uint256 makerEthAmount,
        uint256 takerEthAmount,
        uint256 protocolFee
    );
    event TradeCancelled(address indexed maker, uint256 indexed nonce);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event FeeBpsUpdated(uint256 previousFeeBps, uint256 newFeeBps);
    event FlatSwapFeeUpdated(uint256 previousFee, uint256 newFee);
    event EscrowDeposited(address indexed account, uint256 amount);
    event EscrowWithdrawn(address indexed account, uint256 amount);
    event FeesWithdrawn(address indexed recipient, uint256 amount);
    event RoyaltiesWithdrawn(address indexed recipient, address indexed to, uint256 amount);
    /// @notice Emitted when an auto-withdraw ETH payout could not be delivered
    ///         directly and was credited to the recipient's escrow instead.
    event ProceedsCredited(address indexed to, uint256 amount);
    /// @notice Emitted when a collection is proposed for (or seeded onto) the
    ///         allowlist. `allowedAt` is the unix time it becomes tradable —
    ///         block.timestamp + ADD_DELAY for a proposal, or block.timestamp
    ///         for a constructor seed. Indexers/watchers should surface these
    ///         during the delay window.
    event CollectionProposed(address indexed collection, uint256 allowedAt);
    /// @notice Emitted when a collection is removed from the allowlist (instant).
    event CollectionRemoved(address indexed collection);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error InvalidSignature();
    error OrderExpired();
    error NonceAlreadyUsed();
    error NotAuthorizedTaker();
    error SelfTrade();
    error EmptyOrder();
    error TooManyItems();
    error NoNFTInTrade();
    error IncorrectPayment();
    error InsufficientEscrow();
    error NotTokenOwner(address nft, uint256 tokenId, address expectedOwner);
    error MissingApproval(address nft, uint256 tokenId, address owner);
    error TransferNotEffective(address nft, uint256 tokenId);
    error NativeTransferFailed(address to, uint256 amount);
    error FeeTooHigh();
    error FlatFeeTooHigh();
    error ZeroAddress();
    error ZeroAmount();
    /// @notice A traded collection is not on the allowlist (never proposed,
    ///         still within its ADD_DELAY window, or removed).
    error CollectionNotAllowed(address collection);
    /// @notice proposeCollection was called on a collection that is already
    ///         live, which would otherwise reset a working collection's timer
    ///         and disable it for ADD_DELAY.
    error AlreadyAllowed(address collection);
    error InvalidNFTItem(address collection, uint256 tokenId);
    error UnsupportedNFTStandard(address collection, uint8 standard);
    error InsufficientTokenBalance(address nft, uint256 tokenId, address owner, uint256 required);
    error RoyaltyExceedsProceeds();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /// @param initialCollections Collections trusted at launch. Seeded with no
    ///        timelock (tradable in the deployment block) because the deployer
    ///        is, by construction, the trust root at genesis — there is no
    ///        compromised-key window to bound before the contract exists. Every
    ///        post-deploy addition instead goes through the ADD_DELAY timelock.
    constructor(
        address initialOwner,
        address initialFeeRecipient,
        address[] memory initialCollections
    )
        EIP712("Handshake", "1")
        Ownable(initialOwner)
    {
        if (initialFeeRecipient == address(0)) revert ZeroAddress();
        feeRecipient = initialFeeRecipient;
        feeBps = 100; // 1%
        flatSwapFee = 0;

        // Seed the launch allowlist. Active immediately (allowedAt ==
        // block.timestamp, and _isAllowedCollection uses >=), so no redeploy is
        // needed for the initial set. Emit CollectionProposed for each so
        // indexers observe the seed exactly as they would a live proposal.
        for (uint256 i = 0; i < initialCollections.length; i++) {
            address c = initialCollections[i];
            if (c == address(0)) revert ZeroAddress();
            collectionAllowedAt[c] = block.timestamp;
            emit CollectionProposed(c, block.timestamp);
        }
    }

    // ---------------------------------------------------------------------
    // Escrow (self-managed; owner can never touch user balances)
    // ---------------------------------------------------------------------

    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        escrowBalance[msg.sender] += msg.value;
        emit EscrowDeposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        _withdraw(msg.sender, amount);
    }

    /// @notice Withdraw your own escrow to an alternate payable address. Lets a
    ///         depositor whose own address cannot receive native ETH (e.g. a
    ///         contract with no payable fallback) still recover its funds. The
    ///         ledger stays keyed to msg.sender, so only you can move your ETH.
    function withdrawTo(address to, uint256 amount) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _withdraw(to, amount);
    }

    /// @notice Claim protocol fees accrued to the caller (the fee recipient).
    ///         Always available, even when the contract is paused.
    function withdrawFees() external nonReentrant {
        _withdrawFees(msg.sender);
    }

    /// @notice Claim your accrued fees to an alternate payable address, in case
    ///         the fee-recipient address itself cannot receive native ETH. Still
    ///         keyed to msg.sender's pending balance — nobody else's fees move.
    function withdrawFeesTo(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _withdrawFees(to);
    }

    function withdrawRoyalties() external nonReentrant { _withdrawRoyalties(msg.sender); }
    function withdrawRoyaltiesTo(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _withdrawRoyalties(to);
    }

    function _withdrawRoyalties(address to) private {
        uint256 amount = pendingRoyalties[msg.sender];
        if (amount == 0) revert ZeroAmount();
        pendingRoyalties[msg.sender] = 0;
        emit RoyaltiesWithdrawn(msg.sender, to, amount);
        _sendNative(to, amount);
    }

    /// @dev Debits the caller's escrow and pays `to`. Reachable only through the
    ///      nonReentrant external wrappers above.
    function _withdraw(address to, uint256 amount) private {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = escrowBalance[msg.sender];
        if (balance < amount) revert InsufficientEscrow();
        escrowBalance[msg.sender] = balance - amount; // effect before interaction
        emit EscrowWithdrawn(msg.sender, amount); // `account` = whose escrow moved
        _sendNative(to, amount);
    }

    /// @dev Debits the caller's pending fees and pays `to`. Reachable only
    ///      through the nonReentrant external wrappers above.
    function _withdrawFees(address to) private {
        uint256 amount = pendingFees[msg.sender];
        if (amount == 0) revert ZeroAmount();
        pendingFees[msg.sender] = 0; // effect before interaction
        emit FeesWithdrawn(to, amount); // `recipient` = payout destination
        _sendNative(to, amount);
    }

    // ---------------------------------------------------------------------
    // Settlement
    // ---------------------------------------------------------------------

    /// @notice Settle a maker-signed order. Caller is the taker and must
    ///         send `takerEthAmount` plus the taker-side protocol fee
    ///         (and the flat swap fee for NFT-only swaps) as msg.value.
    /// @dev Slither triage:
    ///   - reentrancy-no-eth (benign / false positive): the function is
    ///     `nonReentrant`, so re-entry into fulfillTrade / withdraw* is blocked
    ///     by the guard. It is CEI-ordered — every consumable state write
    ///     (nonceUsed, the maker escrow debit, and the pendingFees accrual) is
    ///     committed in the Effects block BEFORE any external call. The only
    ///     state written after the external NFT transfers is the additive
    ///     `escrowBalance[to] += amount` credit in _payout, which runs on the
    ///     payout-failure fallback; it is a pure increment of the recipient's
    ///     own balance, never a read-modify-write of a value a callback observed
    ///     stale, and it cannot be withdrawn until the guard is released (by
    ///     which point it is finalized). No callback can act on partial state,
    ///     so the solvency invariant (balance == Σescrow + ΣpendingFees + ΣpendingRoyalties) holds. Every incoming ETH wei is either paid out or retained in exactly one of those pull-payment ledgers; seller royalties reduce the matching payout by the identical credited amount.
    ///   - timestamp (accepted by design): `block.timestamp >= order.expiry`
    ///     is an intentional settlement deadline; miner drift of a few seconds
    ///     cannot change trade economics, only whether a near-expiry order fills.
    ///   - cyclomatic-complexity (accepted): the settlement path deliberately
    ///     performs all validation inline; decomposing it would add call surface
    ///     and stack juggling for no security benefit.
    // slither-disable-next-line reentrancy-no-eth,timestamp,cyclomatic-complexity
    function fulfillTrade(TradeOrder calldata order, bytes calldata signature)
        external
        payable
        nonReentrant
        whenNotPaused
    {
        // ----- Checks -----
        if (order.makerNFTs.length == 0 && order.makerEthAmount == 0) revert EmptyOrder();
        if (order.takerNFTs.length == 0 && order.takerEthAmount == 0) revert EmptyOrder();
        // This is an NFT marketplace: at least one side must move an NFT. Reject
        // ETH-only (native-for-native) orders so they can't settle here and
        // pollute trade/volume accounting.
        if (order.makerNFTs.length == 0 && order.takerNFTs.length == 0) revert NoNFTInTrade();
        if (order.makerNFTs.length > MAX_ITEMS_PER_SIDE || order.takerNFTs.length > MAX_ITEMS_PER_SIDE) {
            revert TooManyItems();
        }
        // Expiry is exclusive: an order is dead at and after its expiry second,
        // matching the app's exclusive off-chain filtering so a taker can't
        // settle during the exact deadline second after the UI shows it expired.
        if (block.timestamp >= order.expiry) revert OrderExpired();
        if (order.taker != address(0) && order.taker != msg.sender) revert NotAuthorizedTaker();
        if (order.maker == msg.sender) revert SelfTrade();
        if (nonceUsed[order.maker][order.nonce]) revert NonceAlreadyUsed();

        // The fee both parties agreed to is baked into the signed order, so the
        // owner can never change the fee on an order after it is signed. We only
        // enforce that it stays within the protocol's hard caps.
        if (order.feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        if (order.flatFee > MAX_FLAT_SWAP_FEE) revert FlatFeeTooHigh();

        // Verify the maker's signature. SignatureChecker accepts both plain
        // EOA (ECDSA) signatures and EIP-1271 signatures from smart-contract
        // wallets (Safe, account abstraction), so those makers are no longer
        // silently excluded. Invalid signatures still fail closed.
        bytes32 orderHash = hashOrder(order);
        if (!SignatureChecker.isValidSignatureNow(order.maker, orderHash, signature)) {
            revert InvalidSignature();
        }

        // Fees: order.feeBps on each ETH leg; flat fee when no ETH moves at all.
        uint256 makerLegFee = (order.makerEthAmount * order.feeBps) / BPS_DENOMINATOR;
        uint256 takerLegFee = (order.takerEthAmount * order.feeBps) / BPS_DENOMINATOR;
        uint256 flatFee = (order.makerEthAmount == 0 && order.takerEthAmount == 0) ? order.flatFee : 0;
        uint256 totalFee = makerLegFee + takerLegFee + flatFee;

        // Taker funds their ETH leg + taker-side fee + flat fee in msg.value.
        if (msg.value != order.takerEthAmount + takerLegFee + flatFee) revert IncorrectPayment();

        // Maker funds their ETH leg + maker-side fee from escrow.
        uint256 makerCost = order.makerEthAmount + makerLegFee;
        if (escrowBalance[order.maker] < makerCost) revert InsufficientEscrow();

        _verifyNFTs(order.makerNFTs, order.maker);
        _verifyNFTs(order.takerNFTs, msg.sender);
        (address[] memory makerRoyaltyRecipients, uint256[] memory makerRoyalties, uint256 makerRoyaltyTotal) =
            _quoteRoyalties(order.makerNFTs, order.takerEthAmount);
        (address[] memory takerRoyaltyRecipients, uint256[] memory takerRoyalties, uint256 takerRoyaltyTotal) =
            _quoteRoyalties(order.takerNFTs, order.makerEthAmount);
        if (makerRoyaltyTotal > order.takerEthAmount || takerRoyaltyTotal > order.makerEthAmount) {
            revert RoyaltyExceedsProceeds();
        }

        // ----- Effects -----
        nonceUsed[order.maker][order.nonce] = true;
        escrowBalance[order.maker] -= makerCost;
        // Fees accrue to the recipient's pull-payment balance instead of being
        // pushed here, so a reverting fee recipient can never brick a trade.
        if (totalFee > 0) pendingFees[feeRecipient] += totalFee;
        for (uint256 i; i < makerRoyaltyRecipients.length; ++i) {
            if (makerRoyalties[i] != 0) pendingRoyalties[makerRoyaltyRecipients[i]] += makerRoyalties[i];
        }
        for (uint256 i; i < takerRoyaltyRecipients.length; ++i) {
            if (takerRoyalties[i] != 0) pendingRoyalties[takerRoyaltyRecipients[i]] += takerRoyalties[i];
        }

        // ----- Interactions -----
        _transferNFTs(order.makerNFTs, order.maker, msg.sender);
        _transferNFTs(order.takerNFTs, msg.sender, order.maker);

        // Auto-withdraw the ETH proceeds: send them directly with a bounded gas
        // stipend so recipients don't need a second transaction, while a hostile
        // recipient still can't grief/OOG the trade — a failed or gas-heavy
        // payout falls back to an escrow credit instead of reverting settlement.
        _payout(order.maker, order.takerEthAmount - makerRoyaltyTotal);
        _payout(msg.sender, order.makerEthAmount - takerRoyaltyTotal);

        emit TradeExecuted(
            orderHash,
            order.maker,
            msg.sender,
            order.makerEthAmount,
            order.takerEthAmount,
            totalFee
        );
    }

    /// @notice Cancel an order nonce. Idempotent-safe: reverts if already used.
    function cancelNonce(uint256 nonce) external {
        if (nonceUsed[msg.sender][nonce]) revert NonceAlreadyUsed();
        nonceUsed[msg.sender][nonce] = true;
        emit TradeCancelled(msg.sender, nonce);
    }

    /// @notice Cancel multiple nonces at once. Idempotent: already-used nonces
    ///         (filled or previously cancelled) are skipped rather than reverting,
    ///         so a taker who front-runs the batch by filling one order cannot
    ///         void the cancellation of every other nonce in the array.
    function cancelNonces(uint256[] calldata nonces) external {
        for (uint256 i = 0; i < nonces.length; i++) {
            if (nonceUsed[msg.sender][nonces[i]]) continue; // skip; don't void the batch
            nonceUsed[msg.sender][nonces[i]] = true;
            emit TradeCancelled(msg.sender, nonces[i]);
        }
    }

    /// @notice Cancel a maker's nonce using the maker's EIP-712 signature, so
    ///         anyone can relay it. This gives EIP-1271 / execution-limited
    ///         smart-wallet makers a trustless on-chain revocation path even when
    ///         the wallet itself cannot make an arbitrary call into this contract.
    ///         The signature is validated via SignatureChecker, so it accepts both
    ///         ECDSA (EOA) and EIP-1271 (contract wallet) signatures — the same
    ///         authorization surface as fulfillTrade. Idempotent: reverts if the
    ///         nonce is already used (filled or cancelled).
    function cancelNonceFor(address maker, uint256 nonce, bytes calldata signature) external {
        if (nonceUsed[maker][nonce]) revert NonceAlreadyUsed();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, maker, nonce)));
        if (!SignatureChecker.isValidSignatureNow(maker, digest, signature)) {
            revert InvalidSignature();
        }
        nonceUsed[maker][nonce] = true;
        emit TradeCancelled(maker, nonce);
    }

    /// @notice EIP-712 digest a maker signs to authorize cancelling `nonce` via
    ///         cancelNonceFor. Exposed so off-chain code can build the message.
    function hashCancel(address maker, uint256 nonce) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CANCEL_TYPEHASH, maker, nonce)));
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function hashOrder(TradeOrder calldata order) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    TRADE_ORDER_TYPEHASH,
                    order.maker,
                    order.taker,
                    _hashNFTItems(order.makerNFTs),
                    _hashNFTItems(order.takerNFTs),
                    order.makerEthAmount,
                    order.takerEthAmount,
                    order.feeBps,
                    order.flatFee,
                    order.nonce,
                    order.expiry
                )
            )
        );
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Whether `c` is currently tradable: it is on the allowlist AND its
    ///         ADD_DELAY timelock has elapsed. Frontends and integrators should
    ///         gate order creation on this so users never build an order that
    ///         reverts with CollectionNotAllowed at fill time. Mirrors the exact
    ///         predicate enforced in _verifyNFTs, so off-chain code need not — and
    ///         must not — re-derive the timelock logic itself.
    function isCollectionAllowed(address c) external view returns (bool) {
        return _isAllowedCollection(c);
    }

    /// @notice Quote the protocol fee for a prospective trade.
    function quoteFees(uint256 makerEthAmount, uint256 takerEthAmount)
        external
        view
        returns (uint256 makerLegFee, uint256 takerLegFee, uint256 flatFee)
    {
        makerLegFee = (makerEthAmount * feeBps) / BPS_DENOMINATOR;
        takerLegFee = (takerEthAmount * feeBps) / BPS_DENOMINATOR;
        flatFee = (makerEthAmount == 0 && takerEthAmount == 0) ? flatSwapFee : 0;
    }

    // ---------------------------------------------------------------------
    // Admin (fee configuration only — never user assets)
    // ---------------------------------------------------------------------

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeBpsUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    function setFlatSwapFee(uint256 newFlatFee) external onlyOwner {
        if (newFlatFee > MAX_FLAT_SWAP_FEE) revert FlatFeeTooHigh();
        emit FlatSwapFeeUpdated(flatSwapFee, newFlatFee);
        flatSwapFee = newFlatFee;
    }

    /// @notice Propose a collection for the tradable allowlist. It becomes
    ///         tradable only after ADD_DELAY has elapsed, giving watchers a
    ///         public window to react (and the owner a window to removeCollection
    ///         it instantly) before a malicious or mistaken listing can settle a
    ///         single trade. This is the ONLY power the owner gains over trading;
    ///         it confers no control over escrow, pending fees, or user assets.
    /// @dev Guards against silently disabling a LIVE collection for ADD_DELAY: if
    ///      the collection is already active, revert AlreadyAllowed. Re-proposing
    ///      a still-pending collection is allowed and overwrites (resets) its
    ///      timer.
    function proposeCollection(address c) external onlyOwner {
        if (c == address(0)) revert ZeroAddress();
        uint256 t = collectionAllowedAt[c];
        if (t != 0 && block.timestamp >= t) revert AlreadyAllowed(c);
        uint256 allowedAt = block.timestamp + ADD_DELAY;
        collectionAllowedAt[c] = allowedAt;
        emit CollectionProposed(c, allowedAt);
    }

    /// @notice Remove a collection from the allowlist. Instant and always
    ///         available — the removal side of the asymmetric timelock — so a
    ///         pending-malicious or newly-discovered-malicious collection can be
    ///         killed within the delay window (or any time after) in a single
    ///         block. Idempotent: removing an absent collection is a no-op write.
    function removeCollection(address c) external onlyOwner {
        collectionAllowedAt[c] = 0; // instant, always available
        emit CollectionRemoved(c);
    }

    /// @notice Emergency stop for new settlements. Escrow withdrawal, fee
    ///         withdrawal, and nonce cancellation stay available while paused
    ///         so users can always exit.
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Internal
    // ---------------------------------------------------------------------

    /// @dev True iff `c` has an allowlist entry whose timelock has elapsed.
    ///      Pure storage read — no external call — so it is safe to run inside
    ///      the checks phase of settlement and adds zero reentrancy surface.
    ///      `>=` makes a collection tradable in the exact block it becomes due
    ///      (and, for a constructor seed, in the deployment block).
    function _isAllowedCollection(address c) internal view returns (bool) {
        uint256 t = collectionAllowedAt[c];
        return t != 0 && block.timestamp >= t;
    }

    function _hashNFTItems(NFTItem[] calldata items) internal pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](items.length);
        for (uint256 i = 0; i < items.length; i++) {
            hashes[i] = keccak256(
                abi.encode(NFT_ITEM_TYPEHASH, items[i].standard, items[i].contractAddress, items[i].tokenId, items[i].amount)
            );
        }
        return keccak256(abi.encodePacked(hashes));
    }

    /// @dev Product policy (REQUIRES HUMAN REVIEW): split an ETH leg evenly by
    /// item count (not ERC-1155 unit count), assigning division remainder to the
    /// earliest items. NFT-only legs have price zero and intentionally pay no
    /// royalty. Collections were allowlist/interface checked before this call.
    function _quoteRoyalties(NFTItem[] calldata items, uint256 salePrice)
        internal view returns (address[] memory recipients, uint256[] memory amounts, uint256 total)
    {
        recipients = new address[](items.length);
        amounts = new uint256[](items.length);
        if (salePrice == 0 || items.length == 0) return (recipients, amounts, 0);
        uint256 each = salePrice / items.length;
        uint256 remainder = salePrice % items.length;
        for (uint256 i; i < items.length; ++i) {
            address collection = items[i].contractAddress;
            // Allowlist was checked before any collection call in _verifyNFTs.
            if (IERC165(collection).supportsInterface(type(IERC2981).interfaceId)) {
                uint256 itemPrice = each + (i < remainder ? 1 : 0);
                (address receiver, uint256 royalty) = IERC2981(collection).royaltyInfo(items[i].tokenId, itemPrice);
                if (receiver == address(0) && royalty != 0) revert ZeroAddress();
                recipients[i] = receiver;
                amounts[i] = royalty;
                total += royalty;
            }
        }
    }

    // slither-disable-start calls-loop
    function _verifyNFTs(NFTItem[] calldata items, address expectedOwner) internal view {
        for (uint256 i; i < items.length; ++i) {
            NFTItem calldata item = items[i];
            // SECURITY: allowlist storage gate is deliberately before every collection call.
            if (!_isAllowedCollection(item.contractAddress)) revert CollectionNotAllowed(item.contractAddress);
            if (item.amount == 0 || (item.standard == 0 && item.amount != 1)) {
                revert InvalidNFTItem(item.contractAddress, item.tokenId);
            }
            bytes4 interfaceId = item.standard == 0 ? type(IERC721).interfaceId : type(IERC1155).interfaceId;
            if (item.standard > 1 || !IERC165(item.contractAddress).supportsInterface(interfaceId)) {
                revert UnsupportedNFTStandard(item.contractAddress, item.standard);
            }
            if (item.standard == 0) {
                IERC721 nft = IERC721(item.contractAddress);
                if (nft.ownerOf(item.tokenId) != expectedOwner) revert NotTokenOwner(item.contractAddress, item.tokenId, expectedOwner);
                if (nft.getApproved(item.tokenId) != address(this) && !nft.isApprovedForAll(expectedOwner, address(this))) {
                    revert MissingApproval(item.contractAddress, item.tokenId, expectedOwner);
                }
            } else {
                uint256 required;
                // Aggregate duplicates, while only checking each key at its first occurrence.
                bool first = true;
                for (uint256 j; j < i; ++j) if (items[j].standard == 1 && items[j].contractAddress == item.contractAddress && items[j].tokenId == item.tokenId) first = false;
                if (!first) continue;
                for (uint256 j = i; j < items.length; ++j) if (items[j].standard == 1 && items[j].contractAddress == item.contractAddress && items[j].tokenId == item.tokenId) required += items[j].amount;
                IERC1155 nft = IERC1155(item.contractAddress);
                if (nft.balanceOf(expectedOwner, item.tokenId) < required) revert InsufficientTokenBalance(item.contractAddress, item.tokenId, expectedOwner, required);
                if (!nft.isApprovedForAll(expectedOwner, address(this))) revert MissingApproval(item.contractAddress, item.tokenId, expectedOwner);
            }
        }
    }

    function _transferNFTs(NFTItem[] calldata items, address from, address to) internal {
        for (uint256 i; i < items.length; ++i) {
            NFTItem calldata item = items[i];
            if (item.standard == 0) {
                IERC721 nft = IERC721(item.contractAddress);
                nft.safeTransferFrom(from, to, item.tokenId);
                if (nft.ownerOf(item.tokenId) != to) revert TransferNotEffective(item.contractAddress, item.tokenId);
            } else {
                IERC1155 nft = IERC1155(item.contractAddress);
                uint256 beforeBalance = nft.balanceOf(to, item.tokenId);
                nft.safeTransferFrom(from, to, item.tokenId, item.amount, "");
                uint256 afterBalance = nft.balanceOf(to, item.tokenId);
                if (afterBalance < beforeBalance || afterBalance - beforeBalance != item.amount) revert TransferNotEffective(item.contractAddress, item.tokenId);
            }
        }
    }
    // slither-disable-end calls-loop

    /// @dev Native transfer that discards callee returndata. The plain
    ///      `to.call{value:}("")` form copies the callee's full returndata into
    ///      this contract's memory, so a hostile recipient can "return-bomb" a
    ///      large blob to inflate the caller's gas cost. The assembly form
    ///      ignores returndata (0-length output buffer) while keeping the same
    ///      revert-on-failure semantics.
    function _sendNative(address to, uint256 amount) internal {
        bool success;
        // assembly (accepted by design): intentional returndata-discard native
        // send (0-length output buffer) to prevent return-bomb griefing; keeps
        // the same revert-on-failure semantics as a checked `.call`.
        // slither-disable-next-line assembly
        assembly {
            success := call(gas(), to, amount, 0, 0, 0, 0)
        }
        if (!success) revert NativeTransferFailed(to, amount);
    }

    /// @dev Auto-withdraw a ETH proceeds leg during settlement. Sends `amount`
    ///      directly to `to` with a bounded gas stipend (so a hostile recipient
    ///      cannot burn gas or OOG the rest of the settlement), discarding
    ///      returndata. If the direct send fails — recipient reverts, needs more
    ///      than the stipend, or is non-payable — the amount is credited to the
    ///      recipient's escrow so the trade never reverts; they pull it later via
    ///      withdraw()/withdrawTo(). Reachable only from the nonReentrant
    ///      fulfillTrade, and all trade state is already finalized before it runs.
    function _payout(address to, uint256 amount) private {
        if (amount == 0) return;
        bool success;
        uint256 stipend = PAYOUT_GAS_STIPEND;
        // assembly (accepted by design): bounded-gas, returndata-discarding
        // native send; failure falls back to an escrow credit below so a hostile
        // recipient can neither OOG the settlement nor return-bomb the caller.
        // slither-disable-next-line assembly
        assembly {
            success := call(stipend, to, amount, 0, 0, 0, 0)
        }
        if (!success) {
            escrowBalance[to] += amount;
            emit ProceedsCredited(to, amount);
        }
    }
}
