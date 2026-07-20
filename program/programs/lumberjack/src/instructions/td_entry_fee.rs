use crate::constants::*;
use crate::errors::GameErrorCode;
use crate::state::highscore::Pricepool;
use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use std::str::FromStr;

/// Charge the fixed entry fee from `signer`, splitting it between the jackpot
/// `pool` (a program-owned `Account<Pricepool>` PDA) and the project
/// `fee_wallet`.
///
/// Both legs are plain System Program transfers from the signer. Depositing INTO
/// a program-owned account this way is fine (the System Program can always add
/// lamports to any account); only DEBITING requires the program to own it, which
/// it does, so payout can direct-debit later. The `fee_wallet` is validated
/// against the hardcoded `FEE_WALLET` pubkey so a caller can't redirect the rake.
pub fn charge_entry_fee<'info>(
    signer: &Signer<'info>,
    pool: &Account<'info, Pricepool>,
    fee_wallet: &UncheckedAccount<'info>,
    system_program: &Program<'info, System>,
) -> Result<()> {
    let expected_fee_wallet =
        Pubkey::from_str(FEE_WALLET).map_err(|_| error!(GameErrorCode::WrongFeeWallet))?;
    require_keys_eq!(
        fee_wallet.key(),
        expected_fee_wallet,
        GameErrorCode::WrongFeeWallet
    );

    // Leg 1: signer -> jackpot pool.
    transfer(
        CpiContext::new(
            system_program.key(),
            Transfer {
                from: signer.to_account_info(),
                to: pool.to_account_info(),
            },
        ),
        ENTRY_FEE_TO_POOL_LAMPORTS,
    )?;

    // Leg 2: signer -> fee wallet (project rake).
    transfer(
        CpiContext::new(
            system_program.key(),
            Transfer {
                from: signer.to_account_info(),
                to: fee_wallet.to_account_info(),
            },
        ),
        ENTRY_FEE_TO_OWNER_LAMPORTS,
    )?;

    Ok(())
}
