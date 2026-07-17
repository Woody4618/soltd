use crate::constants::*;
use crate::errors::GameErrorCode;
use crate::state::td_board::*;
use anchor_lang::prelude::*;
use session_keys::{Session, SessionToken};

/// Place a new basic tower on tile (x, y). The tower starts building and only
/// becomes able to shoot at `ready_at_tick = current_tick + TOWER_BUILD_TICKS`.
pub fn place_tower(ctx: Context<PlaceTower>, x: u8, y: u8) -> Result<()> {
    let board = &mut ctx.accounts.board.load_mut()?;

    require!(board.in_bounds(x, y), GameErrorCode::OutOfBounds);
    require!(!board.is_on_path(x, y), GameErrorCode::TileOccupied);
    require!(!board.tile_has_tower(x, y), GameErrorCode::TileOccupied);
    require!(
        (board.tower_count as usize) < MAX_TOWERS,
        GameErrorCode::TowerLimitReached
    );
    require!(
        board.gold >= TOWER_BASIC_COST,
        GameErrorCode::NotEnoughGold
    );

    board.gold = board
        .gold
        .checked_sub(TOWER_BASIC_COST)
        .ok_or(GameErrorCode::NotEnoughGold)?;

    let ready_at_tick = board
        .current_tick
        .checked_add(TOWER_BUILD_TICKS)
        .ok_or(GameErrorCode::GameOver)?;

    let idx = board.tower_count as usize;
    let tower = &mut board.towers[idx];
    tower.kind = TOWER_KIND_BASIC;
    tower.level = 1;
    tower.x = x;
    tower.y = y;
    tower.range_subtiles = TOWER_BASIC_RANGE_SUBTILES;
    tower.damage = TOWER_BASIC_DAMAGE;
    tower.cooldown_ticks = TOWER_BASIC_COOLDOWN_TICKS;
    tower.pending_level = 0;
    tower._pad2 = [0; 3];
    tower.pending_damage = 0;
    tower.pending_range_subtiles = 0;
    tower._pad3 = 0;
    tower.last_shot_tick = 0;
    tower.ready_at_tick = ready_at_tick;

    board.tower_count = board
        .tower_count
        .checked_add(1)
        .ok_or(GameErrorCode::TowerLimitReached)?;

    Ok(())
}

#[derive(Accounts, Session)]
pub struct PlaceTower<'info> {
    #[session(
        signer = signer,
        authority = authority.key()
    )]
    // Optional session token: when present the ephemeral `signer` acts for
    // `authority`; when absent the `authority` must sign (gated in lib.rs).
    pub session_token: Option<Account<'info, SessionToken>>,

    #[account(
        mut,
        seeds = [b"board".as_ref(), authority.key().as_ref()],
        bump,
    )]
    pub board: AccountLoader<'info, Board>,

    /// CHECK: The board is a PDA of this key; the session/authority gate in
    /// lib.rs verifies it matches the board's stored authority.
    pub authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub signer: Signer<'info>,
}
