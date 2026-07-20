use crate::constants::*;
use crate::state::highscore::Highscore;
use anchor_lang::prelude::*;

/// Create the singleton highscore account. Anyone can call this once; it's a
/// bootstrap so the list PDA exists before the first game. The jackpot pool is
/// created separately by `init_pool` so each singleton can be bootstrapped
/// independently (important when one already exists on-chain but the other
/// doesn't).
pub fn init_highscore(ctx: Context<InitHighscore>) -> Result<()> {
    let hs = &mut ctx.accounts.highscore;
    hs.count = 0;
    hs.last_reset = 0;
    Ok(())
}

#[derive(Accounts)]
pub struct InitHighscore<'info> {
    #[account(
        init,
        payer = signer,
        space = Highscore::SIZE,
        seeds = [HIGHSCORE_SEED],
        bump,
    )]
    pub highscore: Account<'info, Highscore>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
