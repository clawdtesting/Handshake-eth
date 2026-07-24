-- Ethereum Market initial schema

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table if not exists profiles (
    wallet_address text primary key check (wallet_address = lower(wallet_address)),
    display_name   text,
    avatar_url     text,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- trade_offers
-- ---------------------------------------------------------------------
create table if not exists trade_offers (
    id                 uuid primary key default gen_random_uuid(),
    chain_id           integer not null,
    maker_address      text not null check (maker_address = lower(maker_address)),
    taker_address      text check (taker_address = lower(taker_address)),
    status             text not null default 'open'
                       check (status in ('open', 'completed', 'cancelled', 'expired')),
    maker_mon_amount   numeric(78, 0) not null default 0,
    taker_mon_amount   numeric(78, 0) not null default 0,
    nonce              numeric(78, 0) not null,
    expiry             bigint not null,
    signature          text not null,
    order_hash         text not null unique,
    is_private         boolean not null default false,
    completed_tx_hash  text,
    cancelled_tx_hash  text,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (chain_id, maker_address, nonce)
);

create index if not exists idx_trade_offers_status on trade_offers (status, created_at desc);
create index if not exists idx_trade_offers_maker on trade_offers (maker_address);
create index if not exists idx_trade_offers_taker on trade_offers (taker_address);

-- ---------------------------------------------------------------------
-- trade_offer_nfts
-- ---------------------------------------------------------------------
create table if not exists trade_offer_nfts (
    id               uuid primary key default gen_random_uuid(),
    trade_offer_id   uuid not null references trade_offers (id) on delete cascade,
    side             text not null check (side in ('maker', 'taker')),
    token_standard   text not null default 'ERC721',
    contract_address text not null check (contract_address = lower(contract_address)),
    token_id         numeric(78, 0) not null,
    quantity         integer not null default 1,
    collection_name  text,
    image_url        text,
    name             text,
    metadata         jsonb
);

create index if not exists idx_trade_offer_nfts_offer on trade_offer_nfts (trade_offer_id);
create index if not exists idx_trade_offer_nfts_contract on trade_offer_nfts (contract_address, token_id);

-- ---------------------------------------------------------------------
-- trade_events
-- ---------------------------------------------------------------------
create table if not exists trade_events (
    id              uuid primary key default gen_random_uuid(),
    trade_offer_id  uuid not null references trade_offers (id) on delete cascade,
    event_type      text not null,
    wallet_address  text,
    tx_hash         text,
    data            jsonb not null default '{}',
    created_at      timestamptz not null default now()
);

create index if not exists idx_trade_events_offer on trade_events (trade_offer_id, created_at desc);

-- ---------------------------------------------------------------------
-- wallet_reputation
-- ---------------------------------------------------------------------
create table if not exists wallet_reputation (
    wallet_address          text primary key check (wallet_address = lower(wallet_address)),
    completed_trades_count  integer not null default 0,
    cancelled_trades_count  integer not null default 0,
    last_trade_at           timestamptz,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- wanted_posts (wanted board)
-- ---------------------------------------------------------------------
create table if not exists wanted_posts (
    id              uuid primary key default gen_random_uuid(),
    wallet_address  text not null check (wallet_address = lower(wallet_address)),
    looking_for     text not null,
    offering        text,
    notes           text,
    created_at      timestamptz not null default now()
);

create index if not exists idx_wanted_posts_created on wanted_posts (created_at desc);

-- ---------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_trade_offers_updated on trade_offers;
create trigger trg_trade_offers_updated before update on trade_offers
    for each row execute function set_updated_at();

drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated before update on profiles
    for each row execute function set_updated_at();

create or replace function bump_wallet_reputation(p_wallet text, p_field text)
returns void as $$
begin
    if p_field not in ('completed_trades_count', 'cancelled_trades_count') then
        raise exception 'invalid reputation field %', p_field;
    end if;
    insert into wallet_reputation (wallet_address, completed_trades_count, cancelled_trades_count, last_trade_at)
    values (
        p_wallet,
        case when p_field = 'completed_trades_count' then 1 else 0 end,
        case when p_field = 'cancelled_trades_count' then 1 else 0 end,
        case when p_field = 'completed_trades_count' then now() else null end
    )
    on conflict (wallet_address) do update set
        completed_trades_count = wallet_reputation.completed_trades_count
            + case when p_field = 'completed_trades_count' then 1 else 0 end,
        cancelled_trades_count = wallet_reputation.cancelled_trades_count
            + case when p_field = 'cancelled_trades_count' then 1 else 0 end,
        last_trade_at = case when p_field = 'completed_trades_count' then now() else wallet_reputation.last_trade_at end,
        updated_at = now();
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- Row level security: all access goes through the service-role API layer.
-- ---------------------------------------------------------------------
alter table profiles enable row level security;
alter table trade_offers enable row level security;
alter table trade_offer_nfts enable row level security;
alter table trade_events enable row level security;
alter table wallet_reputation enable row level security;
alter table wanted_posts enable row level security;
