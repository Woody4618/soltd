use crate::constants::*;
use crate::errors::GameErrorCode;
use crate::state::td_board::*;
use anchor_lang::prelude::*;

/// Queue a wave of `count` enemy units. Each unit gets a deterministic
/// `spawn_tick` = current_tick + UNIT_SPAWN_DELAY_TICKS + i * stagger, so the
/// wave files onto the path one unit at a time after the build delay. Units do
/// not move until `advance_game` runs (added in a later milestone).
pub fn spawn_wave(ctx: Context<SpawnWave>, count: u8) -> Result<()> {
    let board = &mut ctx.accounts.board.load_mut()?;

    require!(board.lives > 0, GameErrorCode::GameOver);

    let base_tick = board
        .current_tick
        .checked_add(UNIT_SPAWN_DELAY_TICKS)
        .ok_or(GameErrorCode::GameOver)?;

    let mut spawned: u64 = 0;
    for _ in 0..count {
        let slot = board.free_unit_slot().ok_or(GameErrorCode::UnitLimitReached)?;

        let spawn_tick = base_tick
            .checked_add(
                spawned
                    .checked_mul(UNIT_SPAWN_STAGGER_TICKS)
                    .ok_or(GameErrorCode::GameOver)?,
            )
            .ok_or(GameErrorCode::GameOver)?;

        let unit = &mut board.units[slot];
        unit.state = UNIT_STATE_QUEUED;
        unit.speed_subtiles = UNIT_BASE_SPEED_SUBTILES;
        unit.hp = UNIT_BASE_HP;
        unit.max_hp = UNIT_BASE_HP;
        unit.reward = UNIT_BASE_REWARD;
        unit.spawn_tick = spawn_tick;
        unit.progress_subtiles = 0;

        board.next_unit_id = board.next_unit_id.saturating_add(1);
        spawned += 1;
    }

    Ok(())
}

#[derive(Accounts)]
pub struct SpawnWave<'info> {
    #[account(
        mut,
        seeds = [b"board".as_ref(), signer.key().as_ref()],
        bump,
    )]
    pub board: AccountLoader<'info, Board>,

    #[account(mut)]
    pub signer: Signer<'info>,
}
