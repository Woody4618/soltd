use crate::constants::*;
use crate::errors::GameErrorCode;
use crate::state::td_board::*;
use anchor_lang::prelude::*;

/// Initialise a fresh tower-defense board with a hardcoded path and starting
/// resources. The board is a zero-copy account so all subsequent game-loop
/// instructions touch it cheaply.
pub fn init_board(ctx: Context<InitBoard>) -> Result<()> {
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

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
