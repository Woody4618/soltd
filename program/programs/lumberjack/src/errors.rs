use anchor_lang::error_code;

#[error_code]
pub enum GameErrorCode {
    #[msg("Not enough energy")]
    NotEnoughEnergy,
    #[msg("Wrong Authority")]
    WrongAuthority,
    #[msg("Path exceeds the maximum length")]
    PathTooLong,
    #[msg("Tile is out of the grid bounds")]
    OutOfBounds,
    #[msg("Tile is already occupied by a tower")]
    TileOccupied,
    #[msg("No free tower slots on the board")]
    TowerLimitReached,
    #[msg("Tower index is invalid")]
    InvalidTower,
    #[msg("Not enough gold")]
    NotEnoughGold,
    #[msg("No free unit slots on the board")]
    UnitLimitReached,
    #[msg("The game is over")]
    GameOver,
    #[msg("Tower is still building and not yet active")]
    TowerNotReady,
}
