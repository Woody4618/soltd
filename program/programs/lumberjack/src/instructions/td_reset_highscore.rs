use crate::constants::*;
use crate::errors::GameErrorCode;
use crate::state::highscore::{Highscore, Pricepool};
use anchor_lang::prelude::*;

/// Reset the highscore list and pay out the jackpot. Callable by ANYONE, but at
/// most once per `HIGHSCORE_RESET_COOLDOWN_SECONDS` (a "once a day" payout).
///
/// Payout goes to the top 3 finishers, split 60/30/10 of the spendable pool.
/// If fewer than 3 players are on the board, the present places absorb the whole
/// spendable pool (the last present place sweeps every unfilled share plus
/// rounding dust) so the jackpot fully drains each payout. The list is then
/// cleared and the cooldown timer stamped.
///
/// The winner accounts are passed as REMAINING ACCOUNTS in leaderboard order
/// (place 1 first). This avoids the Anchor optional-account signer-positioning
/// pitfall (a trailing required `signer` after `Option<..>` fields can get its
/// is_signer flag dropped).
///
/// The `pool` is a PROGRAM-OWNED data account (Account<Pricepool>), exactly like
/// solana-2048's `price_pool`, so we move lamports OUT of it by DIRECT lamport
/// manipulation - no CPI, no PDA signing needed (the runtime allows a program to
/// debit accounts it owns).
pub fn reset_highscore(ctx: Context<ResetHighscore>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    // Rate limit + snapshot winners, scoping the highscore borrow.
    let (places, winners) = {
        let hs = &mut ctx.accounts.highscore;

        if hs.last_reset != 0 {
            let elapsed = now.saturating_sub(hs.last_reset);
            require!(
                elapsed >= HIGHSCORE_RESET_COOLDOWN_SECONDS,
                GameErrorCode::ResetTooSoon
            );
        }

        let count = hs.count as usize;
        require!(count > 0, GameErrorCode::EmptyHighscore);

        // Number of places actually paid = min(players on board, top-N).
        let places = count.min(PAYOUT_WINNERS);

        // Snapshot the winner pubkeys for the paid places.
        let mut winners = [Pubkey::default(); PAYOUT_WINNERS];
        for (i, w) in winners.iter_mut().enumerate().take(places) {
            *w = hs.entries[i].player;
        }
        (places, winners)
    };

    // The caller must supply one winner account per paid place, in leaderboard
    // order, as remaining accounts.
    require!(
        ctx.remaining_accounts.len() >= places,
        GameErrorCode::WrongWinner
    );

    // Spendable = pool balance minus its rent-exempt reserve, so the pool
    // account stays alive (rent-exempt) for the next period. Same idea as
    // solana-2048's `lamports - 2000000` guard, but rent-exact.
    let pool_ai = ctx.accounts.pool.to_account_info();
    let rent_exempt = Rent::get()?.minimum_balance(pool_ai.data_len());
    let spendable = pool_ai.lamports().saturating_sub(rent_exempt);

    // Track how much of the spendable pool is still unpaid. The LAST present
    // place sweeps whatever remains, so the whole spendable pool drains out
    // every payout (no leftover from missing places or integer rounding). This
    // is why when only 1 player is on the board they get 100% of the pool, not
    // just their 60% share.
    let mut remaining = spendable;

    for place in 0..places {
        let winner_ai = &ctx.remaining_accounts[place];
        // The remaining account at this position must be the matching winner.
        require_keys_eq!(
            winner_ai.key(),
            winners[place],
            GameErrorCode::WrongWinner
        );

        // Last present place gets everything still unpaid (sweeps missing-place
        // shares + rounding dust); earlier places get their fixed percentage.
        let share = if place == places - 1 {
            remaining
        } else {
            spendable
                .checked_mul(PAYOUT_SHARES_PERCENT[place])
                .ok_or(GameErrorCode::Overflow)?
                / 100
        };
        if share == 0 {
            continue;
        }

        // Direct lamport move: pool -> winner. Allowed because the pool is
        // owned by THIS program (solana-2048 does the exact same thing).
        **pool_ai.try_borrow_mut_lamports()? = pool_ai
            .lamports()
            .checked_sub(share)
            .ok_or(GameErrorCode::Overflow)?;
        **winner_ai.try_borrow_mut_lamports()? = winner_ai
            .lamports()
            .checked_add(share)
            .ok_or(GameErrorCode::Overflow)?;
        remaining = remaining.saturating_sub(share);
        msg!(
            "Paid place {} ({} lamports) to {}",
            place + 1,
            share,
            winners[place]
        );
    }

    ctx.accounts.highscore.clear(now);
    Ok(())
}

#[derive(Accounts)]
pub struct ResetHighscore<'info> {
    #[account(
        mut,
        seeds = [HIGHSCORE_SEED],
        bump,
    )]
    pub highscore: Account<'info, Highscore>,

    #[account(
        mut,
        seeds = [POOL_SEED],
        bump,
    )]
    pub pool: Account<'info, Pricepool>,

    #[account(mut)]
    pub signer: Signer<'info>,

    pub system_program: Program<'info, System>,
    // Winner accounts (top-N, in leaderboard order) are passed as remaining
    // accounts, each writable. Verified in the handler against the highscore.
}
