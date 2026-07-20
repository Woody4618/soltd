use crate::constants::*;
use crate::errors::GameErrorCode;
use crate::state::td_board::*;
use anchor_lang::prelude::*;
use session_keys::{Session, SessionToken};

/// Advance the deterministic simulation forward.
///
/// The number of ticks actually applied is
///   `min(requested_ticks, MAX_TICKS_PER_SLICE, real_time_budget)`
/// where `real_time_budget = elapsed_seconds * 1000 / MS_PER_TICK`. The wall
/// clock is used ONLY to bound how far the sim may advance (so a client cannot
/// fast-forward faster than real time); it is never used as game time. All game
/// math inside `apply_ticks` is a pure integer function of the tick counter.
///
/// `counter` only exists to make rapid same-block slices produce distinct
/// transaction signatures (mirrors `chop_tree`).
pub fn advance_game(ctx: Context<AdvanceGame>, requested_ticks: u16, _counter: u16) -> Result<()> {
    let board = &mut ctx.accounts.board.load_mut()?;

    require!(board.lives > 0, GameErrorCode::GameOver);

    let now = Clock::get()?.unix_timestamp;
    let elapsed = now.saturating_sub(board.last_tick_timestamp).max(0) as u64;
    let time_budget = elapsed
        .saturating_mul(1000)
        .checked_div(MS_PER_TICK as u64)
        .unwrap_or(0);

    let allowed = (requested_ticks as u64)
        .min(MAX_TICKS_PER_SLICE)
        .min(time_budget);

    if allowed > 0 {
        // `apply_ticks` may apply FEWER than `allowed` ticks if it runs low on
        // compute budget (dense board). Bookkeeping below uses the number
        // ACTUALLY applied so the clock never runs ahead of the simulation; the
        // client detects the shortfall (on-chain current_tick still behind its
        // target) and simply calls advance_game again to drain the backlog.
        let applied = board.apply_ticks(allowed);

        // Advance the clock only by the real time actually CONSUMED by the ticks
        // we applied - not all the way to `now`. If the caller requested fewer
        // ticks than the elapsed budget would allow (e.g. a small "settle"
        // advance before placing a tower), the leftover budget carries over so
        // the NEXT advance can proceed immediately instead of waiting for fresh
        // seconds to accrue. Integer seconds; sub-second remainder is rounded
        // down and effectively rolls into the next call.
        let consumed_seconds = applied
            .saturating_mul(MS_PER_TICK as u64)
            .checked_div(1000)
            .unwrap_or(0) as i64;
        board.last_tick_timestamp = board.last_tick_timestamp.saturating_add(consumed_seconds);

        // Anti-cheat: never let the timestamp trail `now` by more than one
        // slice's worth of real time. Otherwise a player who doesn't advance
        // for a long time could bank unlimited budget and later fast-forward in
        // bursts. This caps carry-over to at most one slice.
        let max_lag_seconds = MAX_TICKS_PER_SLICE
            .saturating_mul(MS_PER_TICK as u64)
            .checked_div(1000)
            .unwrap_or(0) as i64;
        if now.saturating_sub(board.last_tick_timestamp) > max_lag_seconds {
            board.last_tick_timestamp = now.saturating_sub(max_lag_seconds);
        }
    }

    Ok(())
}

#[derive(Accounts, Session)]
pub struct AdvanceGame<'info> {
    #[session(
        // The ephemeral key pair signing the transaction.
        signer = signer,
        // The game owner that must have created the session.
        authority = authority.key()
    )]
    // Session Tokens are passed as an optional account. When present the
    // ephemeral `signer` acts on behalf of `authority`; when absent the
    // `authority` itself must sign.
    pub session_token: Option<Account<'info, SessionToken>>,

    #[account(
        mut,
        seeds = [b"board".as_ref(), authority.key().as_ref()],
        bump,
    )]
    pub board: AccountLoader<'info, Board>,

    /// CHECK: The board is a PDA of this key, and the session/authority gate in
    /// `lib.rs` verifies it matches the board's stored authority.
    pub authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub signer: Signer<'info>,
}
