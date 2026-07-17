pub use crate::errors::GameErrorCode;
pub use anchor_lang::prelude::*;
pub use session_keys::{session_auth_or, Session, SessionError};
pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
use instructions::*;

declare_id!("td8VwogVVaauJYMNYWEsagCHiX7P3imLC2kuW23rZkm");

#[program]
pub mod lumberjack {

    use super::*;

    pub fn init_player(ctx: Context<InitPlayer>, _level_seed: String) -> Result<()> {
        init_player::init_player(ctx)
    }

    // This function lets the player chop a tree and get 1 wood. The session_auth_or macro
    // lets the player either use their session token or their main wallet. (The counter is only
    // there so that the player can do multiple transactions in the same block. Without it multiple transactions
    // in the same block would result in the same signature and therefore fail.)
    #[session_auth_or(
        ctx.accounts.player.authority.key() == ctx.accounts.signer.key(),
        GameErrorCode::WrongAuthority
    )]
    pub fn chop_tree(ctx: Context<ChopTree>, _level_seed: String, counter: u16) -> Result<()> {
        chop_tree::chop_tree(ctx, counter, 1)
    }

    // -----------------------------------------------------------------------
    // Tower Defense
    // -----------------------------------------------------------------------

    pub fn init_board(ctx: Context<InitBoard>) -> Result<()> {
        td_init_board::init_board(ctx)
    }

    pub fn reset_board(ctx: Context<ResetBoard>) -> Result<()> {
        td_reset_board::reset_board(ctx)
    }

    // Signable by the board's authority (main wallet) or a valid session key
    // for that authority - so towers can be built without a wallet popup once a
    // session exists. Same gate shape as `advance_game`.
    #[session_auth_or(
        ctx.accounts.board.load()?.authority == ctx.accounts.signer.key(),
        GameErrorCode::WrongAuthority
    )]
    pub fn place_tower(ctx: Context<PlaceTower>, x: u8, y: u8) -> Result<()> {
        td_place_tower::place_tower(ctx, x, y)
    }

    #[session_auth_or(
        ctx.accounts.board.load()?.authority == ctx.accounts.signer.key(),
        GameErrorCode::WrongAuthority
    )]
    pub fn upgrade_tower(ctx: Context<UpgradeTower>, tower_index: u8) -> Result<()> {
        td_upgrade_tower::upgrade_tower(ctx, tower_index)
    }

    pub fn spawn_wave(ctx: Context<SpawnWave>, count: u8) -> Result<()> {
        td_spawn_wave::spawn_wave(ctx, count)
    }

    // Advance the deterministic sim. Signable either by the board's authority
    // (main wallet) or by a valid session key for that authority. When signing
    // directly (no session token) the gate requires the signer to BE the
    // board's authority; the session path is validated by the `Session` derive
    // (session_token.authority == authority, session_signer == signer).
    #[session_auth_or(
        ctx.accounts.board.load()?.authority == ctx.accounts.signer.key(),
        GameErrorCode::WrongAuthority
    )]
    pub fn advance_game(
        ctx: Context<AdvanceGame>,
        requested_ticks: u16,
        counter: u16,
    ) -> Result<()> {
        td_advance_game::advance_game(ctx, requested_ticks, counter)
    }
}
