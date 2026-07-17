use crate::constants::*;
use crate::errors::GameErrorCode;
use crate::state::td_board::*;
use anchor_lang::prelude::*;
use session_keys::{Session, SessionToken};

/// Queue a one-level upgrade for a tower. Like the initial build, the boosted
/// damage/range are deferred: they're stored in the tower's `pending_*` fields
/// and only take effect once `current_tick` reaches `ready_at_tick`
/// (`TOWER_UPGRADE_BUILD_TICKS` from now). The tower keeps shooting at its
/// current stats during the build. Applying the pending stats happens inside
/// the deterministic tick loop so the client stays in sync.
pub fn upgrade_tower(ctx: Context<UpgradeTower>, tower_index: u8) -> Result<()> {
    let board = &mut ctx.accounts.board.load_mut()?;
    let current_tick = board.current_tick;

    let idx = tower_index as usize;
    require!(
        idx < board.tower_count as usize,
        GameErrorCode::InvalidTower
    );
    require!(
        board.towers[idx].kind != TOWER_KIND_NONE,
        GameErrorCode::InvalidTower
    );
    // Reject if an upgrade is already in progress for this tower.
    require!(
        board.towers[idx].pending_level == 0,
        GameErrorCode::InvalidTower
    );
    // Reject if the tower is still finishing its INITIAL build (not yet armed).
    // With pending_level == 0 (checked above), ready_at_tick still in the future
    // means the placement build hasn't completed - you can't upgrade an inactive
    // tower.
    require!(
        current_tick >= board.towers[idx].ready_at_tick,
        GameErrorCode::TowerNotReady
    );
    require!(
        board.towers[idx].level < TOWER_MAX_LEVEL,
        GameErrorCode::InvalidTower
    );
    require!(
        board.gold >= TOWER_UPGRADE_COST,
        GameErrorCode::NotEnoughGold
    );

    board.gold = board
        .gold
        .checked_sub(TOWER_UPGRADE_COST)
        .ok_or(GameErrorCode::NotEnoughGold)?;

    let ready_at_tick = current_tick
        .checked_add(TOWER_UPGRADE_BUILD_TICKS)
        .ok_or(GameErrorCode::GameOver)?;

    let tower = &mut board.towers[idx];
    tower.pending_level = tower
        .level
        .checked_add(1)
        .ok_or(GameErrorCode::InvalidTower)?;
    tower.pending_damage = tower
        .damage
        .checked_add(TOWER_UPGRADE_DAMAGE_BONUS)
        .ok_or(GameErrorCode::InvalidTower)?;
    tower.pending_range_subtiles = tower
        .range_subtiles
        .checked_add(TOWER_UPGRADE_RANGE_BONUS)
        .ok_or(GameErrorCode::InvalidTower)?;
    tower.ready_at_tick = ready_at_tick;

    Ok(())
}

#[derive(Accounts, Session)]
pub struct UpgradeTower<'info> {
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
