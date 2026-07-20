use crate::constants::*;
use crate::errors::GameErrorCode;
use crate::instructions::td_entry_fee::charge_entry_fee;
use crate::state::highscore::Pricepool;
use crate::state::td_board::*;
use anchor_lang::prelude::*;

/// Initialise a fresh tower-defense board with a hardcoded path and starting
/// resources. The board is a zero-copy account so all subsequent game-loop
/// instructions touch it cheaply.
///
/// Starting a game costs the fixed entry fee, split between the jackpot pool
/// and the project fee wallet.
pub fn init_board(ctx: Context<InitBoard>) -> Result<()> {
    charge_entry_fee(
        &ctx.accounts.signer,
        &ctx.accounts.pool,
        &ctx.accounts.fee_wallet,
        &ctx.accounts.system_program,
    )?;

    let board = &mut ctx.accounts.board.load_init()?;

    board.authority = ctx.accounts.signer.key();
    board.current_tick = 0;
    board.last_tick_timestamp = Clock::get()?.unix_timestamp;
    board.last_id = 0;
    board.grid_size = GRID_SIZE;
    board.tower_count = 0;
    board.lives = STARTING_LIVES;
    board.gold = STARTING_GOLD;
    board.kills = 0;
    board.next_unit_id = 0;
    board.wave_number = 0;
    board.next_wave_tick = WAVE_FIRST_DELAY_TICKS;
    board.scored = 0;

    // A simple deterministic L-shaped path across the 8x8 grid:
    // (0,0) -> (0,4) -> (7,4) -> (7,7)
    let waypoints: [(u8, u8); 4] = [(0, 0), (0, 4), (7, 4), (7, 7)];
    require!(
        waypoints.len() <= MAX_PATH_LEN,
        GameErrorCode::PathTooLong
    );
    for (i, (x, y)) in waypoints.iter().enumerate() {
        board.path[i].x = *x;
        board.path[i].y = *y;
    }
    board.path_len = waypoints.len() as u8;

    Ok(())
}

#[derive(Accounts)]
pub struct InitBoard<'info> {
    #[account(
        init,
        payer = signer,
        space = 8 + std::mem::size_of::<Board>(),
        seeds = [b"board".as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub board: AccountLoader<'info, Board>,

    // Jackpot pool: a program-owned PDA (Account<Pricepool>) that escrows entry
    // fees. Program-owned so payout can direct-debit it (see reset_highscore).
    // `init_if_needed` bootstraps the pool on the very first game so no separate
    // init step is required; on every subsequent game it just loads the existing
    // account (Anchor still enforces owner + seeds).
    #[account(
        init_if_needed,
        payer = signer,
        space = Pricepool::SIZE,
        seeds = [POOL_SEED],
        bump,
    )]
    pub pool: Account<'info, Pricepool>,

    /// CHECK: validated in `charge_entry_fee` against the hardcoded FEE_WALLET.
    #[account(mut)]
    pub fee_wallet: UncheckedAccount<'info>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
