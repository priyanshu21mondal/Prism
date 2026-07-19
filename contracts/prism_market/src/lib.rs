#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Bytes,
    BytesN, Env,
};

const STROOPS_PER_XLM: i128 = 10_000_000;
const DEFAULT_MIN_STAKE: i128 = 5 * STROOPS_PER_XLM;
const DEFAULT_MAX_MULTIPLIER: u32 = 10;
const FEE_BPS: i128 = 200;
const BPS_DENOMINATOR: i128 = 10_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Market {
    pub id: u64,
    pub min_stake: i128,
    pub max_range_width: u64,
    pub max_multiplier: u32,
    pub resolution_time: u64,
    pub sealed_count: u32,
    pub claimed_count: u32,
    pub actual_value: i128,
    pub settled: bool,
    pub active: bool,
    pub total_pool: i128,
    pub claimed_pool: i128,
    pub fee_collected: i128,
    pub winner_count: u32,
    pub loser_count: u32,
    pub treasury_address: Address,
    pub resolver_address: Address,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MarketStats {
    pub total_pool: i128,
    pub claimed_pool: i128,
    pub fee_collected: i128,
    pub winner_count: u32,
    pub loser_count: u32,
    pub sealed_count: u32,
    pub claimed_count: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommitmentRecord {
    pub market_id: u64,
    pub wallet: Address,
    pub commitment_hash: BytesN<32>,
    pub encrypted_blob: Bytes,
    pub stake: i128,
    pub claimed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClaimRecord {
    pub market_id: u64,
    pub wallet: Address,
    pub predicted_low: i128,
    pub predicted_high: i128,
    pub payout: i128,
    pub fee: i128,
}

#[contractevent]
pub struct Initialized {
    pub admin: Address,
    pub xlm_token: Address,
}

#[contractevent]
pub struct MarketCreated {
    #[topic]
    pub market_id: u64,
    pub market: Market,
}

#[contractevent]
pub struct PoolFunded {
    #[topic]
    pub market_id: u64,
    pub funder: Address,
    pub amount: i128,
}

#[contractevent]
pub struct MarketSettled {
    #[topic]
    pub market_id: u64,
    pub actual_value: i128,
}

#[contractevent]
pub struct PredictionCommitted {
    #[topic]
    pub market_id: u64,
    pub wallet: Address,
    pub commitment_hash: BytesN<32>,
    pub stake: i128,
}

#[contractevent]
pub struct ClaimMissed {
    #[topic]
    pub market_id: u64,
    pub wallet: Address,
}

#[contractevent]
pub struct ClaimPaid {
    #[topic]
    pub market_id: u64,
    pub wallet: Address,
    pub payout: i128,
    pub fee: i128,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    XlmToken,
    Market(u64),
    Commitment(u64, Address),
    Claim(u64, Address),
    Nullifier(u64, Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    MarketExists = 2,
    MarketMissing = 3,
    MarketInactive = 4,
    DuplicateCommitment = 5,
    InvalidStake = 6,
    PoolMissing = 7,
    AlreadySettled = 8,
    NotSettled = 9,
    AlreadyClaimed = 10,
    RangeMiss = 11,
    InvalidRange = 12,
    InvalidCommitment = 13,
    InsufficientPool = 14,
    BelowMinStake = 15,
    UnauthorizedResolver = 16,
    MarketNotReady = 17,
    UnauthorizedAdmin = 18,
    InvalidMarketConfig = 19,
    EmptyEncryptedBlob = 20,
}

#[contract]
pub struct PrismMarketContract;

#[contractimpl]
impl PrismMarketContract {
    pub fn __constructor(env: Env, admin: Address, xlm_token: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::XlmToken, &xlm_token);
        Initialized { admin, xlm_token }.publish(&env);

        Ok(())
    }

    pub fn create_market(
        env: Env,
        admin: Address,
        market_id: u64,
        max_range_width: u64,
        max_multiplier: u32,
        min_stake: i128,
        resolution_time: u64,
        treasury_address: Address,
        resolver_address: Address,
    ) -> Result<(), Error> {
        require_admin(&env, &admin)?;

        let key = DataKey::Market(market_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::MarketExists);
        }
        if max_range_width == 0 || resolution_time == 0 {
            return Err(Error::InvalidMarketConfig);
        }

        let market = Market {
            id: market_id,
            min_stake: if min_stake > 0 { min_stake } else { DEFAULT_MIN_STAKE },
            max_range_width,
            max_multiplier: if max_multiplier > 0 {
                max_multiplier
            } else {
                DEFAULT_MAX_MULTIPLIER
            },
            resolution_time,
            sealed_count: 0,
            claimed_count: 0,
            actual_value: 0,
            settled: false,
            active: true,
            total_pool: 0,
            claimed_pool: 0,
            fee_collected: 0,
            winner_count: 0,
            loser_count: 0,
            treasury_address,
            resolver_address,
        };

        env.storage().persistent().set(&key, &market);
        MarketCreated { market_id, market }.publish(&env);

        Ok(())
    }

    pub fn commit_prediction(
        env: Env,
        wallet: Address,
        market_id: u64,
        commitment_hash: BytesN<32>,
        encrypted_blob: Bytes,
        stake: i128,
    ) -> Result<(), Error> {
        commit_internal(env, wallet, market_id, commitment_hash, encrypted_blob, stake)
    }

    pub fn commit(
        env: Env,
        wallet: Address,
        market_id: u64,
        commitment_hash: BytesN<32>,
        encrypted_blob: Bytes,
        stake: i128,
    ) -> Result<(), Error> {
        commit_internal(env, wallet, market_id, commitment_hash, encrypted_blob, stake)
    }

    pub fn settle_market(
        env: Env,
        resolver: Address,
        market_id: u64,
        actual_value: i128,
    ) -> Result<(), Error> {
        resolver.require_auth();

        let market_key = DataKey::Market(market_id);
        let mut market: Market = env
            .storage()
            .persistent()
            .get(&market_key)
            .ok_or(Error::MarketMissing)?;

        if resolver != market.resolver_address {
            return Err(Error::UnauthorizedResolver);
        }

        if market.settled {
            return Err(Error::AlreadySettled);
        }

        if env.ledger().timestamp() < market.resolution_time {
            return Err(Error::MarketNotReady);
        }

        market.actual_value = actual_value;
        market.settled = true;
        market.active = false;
        env.storage().persistent().set(&market_key, &market);
        MarketSettled { market_id, actual_value }.publish(&env);

        Ok(())
    }

    pub fn claim_winnings(
        env: Env,
        wallet: Address,
        market_id: u64,
        predicted_low: i128,
        predicted_high: i128,
        _salt: BytesN<32>,
        submitted_commitment: BytesN<32>,
    ) -> Result<i128, Error> {
        claim_internal(
            env,
            wallet,
            market_id,
            predicted_low,
            predicted_high,
            submitted_commitment,
        )
    }

    pub fn claim(
        env: Env,
        wallet: Address,
        market_id: u64,
        predicted_low: i128,
        predicted_high: i128,
        _multiplier_tier: u32,
    ) -> Result<i128, Error> {
        let submitted_commitment = BytesN::from_array(&env, &[0; 32]);
        claim_internal(
            env,
            wallet,
            market_id,
            predicted_low,
            predicted_high,
            submitted_commitment,
        )
    }

    pub fn fund_pool(
        env: Env,
        funder: Address,
        market_id: u64,
        amount: i128,
    ) -> Result<(), Error> {
        funder.require_auth();
        let _market = Self::get_market(env.clone(), market_id)?;
        if amount <= 0 {
            return Err(Error::InvalidStake);
        }
        let market_key = DataKey::Market(market_id);
        let mut market: Market = env
            .storage()
            .persistent()
            .get(&market_key)
            .ok_or(Error::MarketMissing)?;

        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::XlmToken)
            .ok_or(Error::PoolMissing)?;
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&funder, &env.current_contract_address(), &amount);
        market.total_pool += amount;
        env.storage().persistent().set(&market_key, &market);
        PoolFunded { market_id, funder, amount }.publish(&env);

        Ok(())
    }

    pub fn get_market(env: Env, market_id: u64) -> Result<Market, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Market(market_id))
            .ok_or(Error::MarketMissing)
    }

    pub fn get_commitment(
        env: Env,
        market_id: u64,
        wallet: Address,
    ) -> Result<CommitmentRecord, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Commitment(market_id, wallet))
            .ok_or(Error::MarketMissing)
    }

    pub fn get_claim(env: Env, market_id: u64, wallet: Address) -> Result<ClaimRecord, Error> {
        env.storage()
            .persistent()
            .get(&DataKey::Claim(market_id, wallet))
            .ok_or(Error::MarketMissing)
    }

    pub fn get_market_stats(env: Env, market_id: u64) -> Result<MarketStats, Error> {
        let market = Self::get_market(env, market_id)?;
        Ok(MarketStats {
            total_pool: market.total_pool,
            claimed_pool: market.claimed_pool,
            fee_collected: market.fee_collected,
            winner_count: market.winner_count,
            loser_count: market.loser_count,
            sealed_count: market.sealed_count,
            claimed_count: market.claimed_count,
        })
    }

    pub fn get_pool_balance(env: Env, market_id: u64) -> Result<i128, Error> {
        let _market = Self::get_market(env.clone(), market_id)?;
        let token_address: Address = env
            .storage()
            .instance()
            .get(&DataKey::XlmToken)
            .ok_or(Error::PoolMissing)?;
        let token_client = token::Client::new(&env, &token_address);
        Ok(token_client.balance(&env.current_contract_address()))
    }

    pub fn is_nullifier_used(env: Env, market_id: u64, wallet: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Nullifier(market_id, wallet))
            .unwrap_or(false)
    }
}

fn commit_internal(
    env: Env,
    wallet: Address,
    market_id: u64,
    commitment_hash: BytesN<32>,
    encrypted_blob: Bytes,
    stake: i128,
) -> Result<(), Error> {
    wallet.require_auth();

    let market_key = DataKey::Market(market_id);
    let mut market: Market = env
        .storage()
        .persistent()
        .get(&market_key)
        .ok_or(Error::MarketMissing)?;

    if !market.active {
        return Err(Error::MarketInactive);
    }

    if stake < market.min_stake {
        return Err(Error::BelowMinStake);
    }
    if encrypted_blob.is_empty() {
        return Err(Error::EmptyEncryptedBlob);
    }

    let commitment_key = DataKey::Commitment(market_id, wallet.clone());
    if env.storage().persistent().has(&commitment_key) {
        return Err(Error::DuplicateCommitment);
    }

    let token_address: Address = env
        .storage()
        .instance()
        .get(&DataKey::XlmToken)
        .ok_or(Error::PoolMissing)?;
    let contract_address = env.current_contract_address();
    let token_client = token::Client::new(&env, &token_address);
    token_client.transfer(&wallet, &contract_address, &stake);

    let record = CommitmentRecord {
        market_id,
        wallet,
        commitment_hash,
        encrypted_blob,
        stake,
        claimed: false,
    };

    market.sealed_count += 1;
    market.total_pool += stake;
    env.storage().persistent().set(&commitment_key, &record);
    env.storage().persistent().set(&market_key, &market);
    PredictionCommitted {
        market_id,
        wallet: record.wallet.clone(),
        commitment_hash: record.commitment_hash.clone(),
        stake,
    }
    .publish(&env);

    Ok(())
}

fn claim_internal(
    env: Env,
    wallet: Address,
    market_id: u64,
    predicted_low: i128,
    predicted_high: i128,
    submitted_commitment: BytesN<32>,
) -> Result<i128, Error> {
    wallet.require_auth();

    let market_key = DataKey::Market(market_id);
    let mut market: Market = env
        .storage()
        .persistent()
        .get(&market_key)
        .ok_or(Error::MarketMissing)?;

    if !market.settled {
        return Err(Error::NotSettled);
    }

    if predicted_high <= predicted_low {
        return Err(Error::InvalidRange);
    }

    let commitment_key = DataKey::Commitment(market_id, wallet.clone());
    let mut commitment: CommitmentRecord = env
        .storage()
        .persistent()
        .get(&commitment_key)
        .ok_or(Error::MarketMissing)?;

    if commitment.claimed || is_nullifier_used_internal(&env, market_id, wallet.clone()) {
        return Err(Error::AlreadyClaimed);
    }

    if submitted_commitment != commitment.commitment_hash {
        return Err(Error::InvalidCommitment);
    }

    let width = predicted_high - predicted_low;
    if width <= 0 || width > market.max_range_width as i128 {
        return Err(Error::InvalidRange);
    }

    if market.actual_value < predicted_low || market.actual_value > predicted_high {
        commitment.claimed = true;
        market.loser_count += 1;
        market.claimed_count += 1;
        env.storage().persistent().set(&commitment_key, &commitment);
        env.storage()
            .persistent()
            .set(&DataKey::Nullifier(market_id, wallet.clone()), &true);
        env.storage().persistent().set(&market_key, &market);
        ClaimMissed { market_id, wallet }.publish(&env);
        return Ok(0);
    }

    let gross_payout = gross_payout_for_width(
        commitment.stake,
        width,
        market.max_range_width as i128,
        market.max_multiplier as i128,
    )?;
    let fee = gross_payout * FEE_BPS / BPS_DENOMINATOR;
    let net_payout = gross_payout - fee;

    let token_address: Address = env
        .storage()
        .instance()
        .get(&DataKey::XlmToken)
        .ok_or(Error::PoolMissing)?;
    let contract_address = env.current_contract_address();
    let token_client = token::Client::new(&env, &token_address);
    let available_pool = token_client.balance(&contract_address);
    if net_payout + fee > available_pool {
        return Err(Error::InsufficientPool);
    }

    if fee > 0 {
        token_client.transfer(&contract_address, &market.treasury_address, &fee);
    }
    token_client.transfer(&contract_address, &wallet, &net_payout);

    commitment.claimed = true;
    market.claimed_count += 1;
    market.winner_count += 1;
    market.claimed_pool += net_payout;
    market.fee_collected += fee;

    let claim = ClaimRecord {
        market_id,
        wallet: wallet.clone(),
        predicted_low,
        predicted_high,
        payout: net_payout,
        fee,
    };

    env.storage().persistent().set(&commitment_key, &commitment);
    env.storage()
        .persistent()
        .set(&DataKey::Nullifier(market_id, wallet.clone()), &true);
    env.storage().persistent().set(&market_key, &market);
    env.storage()
        .persistent()
        .set(&DataKey::Claim(market_id, wallet), &claim);
    ClaimPaid {
        market_id,
        wallet: claim.wallet,
        payout: net_payout,
        fee,
    }
    .publish(&env);

    Ok(net_payout)
}

fn is_nullifier_used_internal(env: &Env, market_id: u64, wallet: Address) -> bool {
    env.storage()
        .persistent()
        .get(&DataKey::Nullifier(market_id, wallet))
        .unwrap_or(false)
}

fn require_admin(env: &Env, candidate: &Address) -> Result<(), Error> {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    candidate.require_auth();
    if admin != *candidate {
        return Err(Error::UnauthorizedAdmin);
    }
    Ok(())
}

fn gross_payout_for_width(
    stake: i128,
    width: i128,
    max_range_width: i128,
    max_multiplier: i128,
) -> Result<i128, Error> {
    if width <= 0 || max_range_width <= 0 || max_multiplier <= 0 {
        return Err(Error::InvalidRange);
    }

    let uncapped_multiplier = (max_range_width / width) - 1;
    let multiplier = if uncapped_multiplier < 1 {
        1
    } else if uncapped_multiplier > max_multiplier {
        max_multiplier
    } else {
        uncapped_multiplier
    };

    Ok(stake * multiplier)
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
    };

    const MARKET_ID: u64 = 42;
    const INITIAL_BALANCE: i128 = 1_000 * STROOPS_PER_XLM;

    struct Fixture {
        env: Env,
        client: PrismMarketContractClient<'static>,
        token: token::Client<'static>,
        contract_id: Address,
        resolver: Address,
        treasury: Address,
        user: Address,
        funder: Address,
        commitment: BytesN<32>,
    }

    fn fixture() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|ledger| ledger.timestamp = 1_000);

        let admin = Address::generate(&env);
        let resolver = Address::generate(&env);
        let treasury = Address::generate(&env);
        let user = Address::generate(&env);
        let funder = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
        let asset = StellarAssetClient::new(&env, &token_id);
        asset.mint(&user, &INITIAL_BALANCE);
        asset.mint(&funder, &INITIAL_BALANCE);

        let contract_id = env.register(
            PrismMarketContract,
            (admin.clone(), token_id.clone()),
        );
        let client = PrismMarketContractClient::new(&env, &contract_id);
        client.create_market(
            &admin,
            &MARKET_ID,
            &1_000,
            &10,
            &(5 * STROOPS_PER_XLM),
            &2_000,
            &treasury,
            &resolver,
        );

        Fixture {
            token: token::Client::new(&env, &token_id),
            contract_id,
            commitment: BytesN::from_array(&env, &[7; 32]),
            env,
            client,
            resolver,
            treasury,
            user,
            funder,
        }
    }

    fn encrypted_blob(env: &Env) -> Bytes {
        Bytes::from_array(env, b"{\"ciphertext\":\"demo\"}")
    }

    #[test]
    fn create_market_persists_configuration() {
        let fixture = fixture();
        let market = fixture.client.get_market(&MARKET_ID);

        assert_eq!(market.id, MARKET_ID);
        assert_eq!(market.active, true);
        assert_eq!(market.resolver_address, fixture.resolver);
        assert_eq!(market.treasury_address, fixture.treasury);
    }

    #[test]
    fn commit_prediction_transfers_stake_and_updates_stats() {
        let fixture = fixture();
        let stake = 10 * STROOPS_PER_XLM;

        fixture.client.commit_prediction(
            &fixture.user,
            &MARKET_ID,
            &fixture.commitment,
            &encrypted_blob(&fixture.env),
            &stake,
        );

        let record = fixture.client.get_commitment(&MARKET_ID, &fixture.user);
        let stats = fixture.client.get_market_stats(&MARKET_ID);
        assert_eq!(record.stake, stake);
        assert_eq!(stats.sealed_count, 1);
        assert_eq!(stats.total_pool, stake);
        assert_eq!(fixture.token.balance(&fixture.contract_id), stake);
    }

    #[test]
    fn resolver_settles_and_winner_claims_net_payout_once() {
        let fixture = fixture();
        let stake = 10 * STROOPS_PER_XLM;
        let pool_top_up = 200 * STROOPS_PER_XLM;

        fixture.client.commit_prediction(
            &fixture.user,
            &MARKET_ID,
            &fixture.commitment,
            &encrypted_blob(&fixture.env),
            &stake,
        );
        fixture.client.fund_pool(&fixture.funder, &MARKET_ID, &pool_top_up);
        fixture.env.ledger().with_mut(|ledger| ledger.timestamp = 2_001);
        fixture.client.settle_market(&fixture.resolver, &MARKET_ID, &550);

        let payout = fixture.client.claim_winnings(
            &fixture.user,
            &MARKET_ID,
            &500,
            &600,
            &BytesN::from_array(&fixture.env, &[1; 32]),
            &fixture.commitment,
        );

        assert_eq!(payout, 882 * STROOPS_PER_XLM / 10);
        let claim = fixture.client.get_claim(&MARKET_ID, &fixture.user);
        let stats = fixture.client.get_market_stats(&MARKET_ID);
        assert_eq!(claim.payout, payout);
        assert_eq!(claim.fee, 18 * STROOPS_PER_XLM / 10);
        assert_eq!(stats.winner_count, 1);
        assert_eq!(stats.claimed_count, 1);
        assert_eq!(fixture.client.is_nullifier_used(&MARKET_ID, &fixture.user), true);
    }

    #[test]
    fn missed_claim_consumes_nullifier_to_prevent_replay_accounting() {
        let fixture = fixture();
        let stake = 10 * STROOPS_PER_XLM;

        fixture.client.commit_prediction(
            &fixture.user,
            &MARKET_ID,
            &fixture.commitment,
            &encrypted_blob(&fixture.env),
            &stake,
        );
        fixture.env.ledger().with_mut(|ledger| ledger.timestamp = 2_001);
        fixture.client.settle_market(&fixture.resolver, &MARKET_ID, &900);

        let first = fixture.client.claim_winnings(
            &fixture.user,
            &MARKET_ID,
            &500,
            &600,
            &BytesN::from_array(&fixture.env, &[1; 32]),
            &fixture.commitment,
        );
        assert_eq!(first, 0);

        let replay = fixture.client.try_claim_winnings(
            &fixture.user,
            &MARKET_ID,
            &500,
            &600,
            &BytesN::from_array(&fixture.env, &[1; 32]),
            &fixture.commitment,
        );
        assert_eq!(replay, Err(Ok(Error::AlreadyClaimed)));

        let stats = fixture.client.get_market_stats(&MARKET_ID);
        assert_eq!(stats.loser_count, 1);
        assert_eq!(stats.claimed_count, 1);
    }
}
