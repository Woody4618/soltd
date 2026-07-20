use crate::constants::*;
use crate::state::highscore::Pricepool;
use anchor_lang::prelude::*;

/// Create the jackpot pool account. Anyone can call this once; it's a one-time
/// bootstrap so the pool PDA exists before the first entry fee is charged. The
/// pool is a PROGRAM-OWNED `Account<Pricepool>` (empty data) - being owned by
/// this program is what lets `reset_highscore` direct-debit lamports out to
/// winners later (mirrors solana-2048's `price_pool`).
pub fn init_pool(_ctx: Context<InitPool>) -> Result<()> {
    Ok(())
}

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(
        init,
        payer = signer,
        space = Pricepool::SIZE,
        seeds = [POOL_SEED],
        bump,
    )]
    pub pool: Account<'info, Pricepool>,

    #[account(mut)]
    pub signer: Signer<'info>,
    pub system_program: Program<'info, System>,
}
