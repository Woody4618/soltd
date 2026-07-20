use crate::constants::*;
use crate::errors::GameErrorCode;
use crate::instructions::td_entry_fee::charge_entry_fee;
use crate::state::highscore::Pricepool;
use crate::state::td_board::*;
use anchor_lang::prelude::*;

/// Reset an existing board back to its starting state without closing the
/// account. Clears all towers and units, restores lives/gold, and rewinds the
/// tick counter so the player can start a fresh game. The path is re-seeded to
/// the same deterministic layout as `init_board`.
///
/// Like starting, resetting costs the fixed entry fee (jackpot + rake).
pub fn reset_board(ctx: Context<ResetBoard>) -> Result<()> {
    {
        let board = ctx.accounts.board.load()?;
        require!(
            board.authority == ctx.accounts.signer.key(),
            GameErrorCode::WrongAuthority
        );
    }

    charge_entry_fee(
        &ctx.accounts.signer,
        &ctx.accounts.pool,
        &ctx.accounts.fee_wallet,
        &ctx.accounts.system_program,
    )?;

    let board = &mut ctx.accounts.board.load_mut()?;

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
    // Clear the scored flag so the fresh game can record its own final score.
    board.scored = 0;

    // Zero out every tower and unit slot so no stale entities survive the reset.
    let mut ti = 0usize;
    while ti < MAX_TOWERS {
        board.towers[ti] = Tower {
            kind: TOWER_KIND_NONE,
            level: 0,
            x: 0,
            y: 0,
            range_subtiles: 0,
            damage: 0,
            cooldown_ticks: 0,
            pending_level: 0,
            _pad2: [0; 3],
            pending_damage: 0,
            pending_range_subtiles: 0,
            splash_radius_subtiles: 0,
            last_shot_tick: 0,
            ready_at_tick: 0,
        };
        ti += 1;
    }

    let mut ui = 0usize;
    while ui < MAX_UNITS {
        board.units[ui] = Unit {
            state: UNIT_STATE_EMPTY,
            enemy_kind: ENEMY_KIND_NORMAL,
            _pad: [0; 2],
            speed_subtiles: 0,
            hp: 0,
            max_hp: 0,
            reward: 0,
            slowed_until_tick: 0,
            spawn_tick: 0,
            progress_subtiles: 0,
        };
        ui += 1;
    }

    // Re-seed the deterministic L-shaped path: (0,0) -> (0,4) -> (7,4) -> (7,7).
    let waypoints: [(u8, u8); 4] = [(0, 0), (0, 4), (7, 4), (7, 7)];
    require!(waypoints.len() <= MAX_PATH_LEN, GameErrorCode::PathTooLong);
    for (i, (x, y)) in waypoints.iter().enumerate() {
        board.path[i].x = *x;
        board.path[i].y = *y;
    }
    board.path_len = waypoints.len() as u8;

    Ok(())
}

#[derive(Accounts)]
pub struct ResetBoard<'info> {
    // `realloc` grows (or shrinks) an existing board to the current `Board`
    // size. This doubles as a migration path: boards created before new fields
    // were added get resized here so `load_mut` succeeds.
    #[account(
        mut,
        seeds = [b"board".as_ref(), signer.key().as_ref()],
        bump,
        realloc = 8 + std::mem::size_of::<Board>(),
        realloc::payer = signer,
        realloc::zero = false,
    )]
    pub board: AccountLoader<'info, Board>,

    // Jackpot pool: a program-owned PDA (Account<Pricepool>) that escrows entry
    // fees. Program-owned so payout can direct-debit it (see reset_highscore).
    // `init_if_needed` bootstraps the pool on demand so no separate init step is
    // required; if it already exists this just loads it (owner + seeds enforced).
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
