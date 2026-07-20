use crate::constants::MAX_HIGHSCORE_ENTRIES;
use anchor_lang::prelude::*;

/// The jackpot pool. A PROGRAM-OWNED, zero-data PDA (seeds `["price_pool"]`)
/// that escrows entry fees. Mirrors solana-2048's `Pricepool`. Being owned by
/// this program (not the System Program) is what lets `reset_highscore`
/// direct-debit lamports out to winners. It carries no fields; the account just
/// needs to exist and hold lamports.
#[account]
pub struct Pricepool {}

impl Pricepool {
    /// 8-byte Anchor discriminator, no data.
    pub const SIZE: usize = 8;
}

/// A single highscore row: the player's main wallet and their best kills in a
/// single game during the current period.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, PartialEq, Eq)]
pub struct HighscoreEntry {
    pub player: Pubkey,
    pub score: u32,
}

/// Global highscore list (a singleton PDA). Keeps the top-N wallets by score
/// for the current period, sorted descending. `last_reset` gates how often the
/// list can be reset + the jackpot paid out.
#[account]
pub struct Highscore {
    /// Number of populated entries in `entries` (<= MAX_HIGHSCORE_ENTRIES).
    pub count: u32,
    /// Unix timestamp of the last reset/payout (0 until first reset).
    pub last_reset: i64,
    /// Top scores, descending. Only the first `count` are meaningful.
    pub entries: [HighscoreEntry; MAX_HIGHSCORE_ENTRIES],
}

impl Highscore {
    /// 8 discriminator + 4 count + 8 last_reset + N * (32 + 4) entries.
    pub const SIZE: usize = 8 + 4 + 8 + MAX_HIGHSCORE_ENTRIES * (32 + 4);

    /// Insert (or upgrade) a player's score into the sorted top-N list,
    /// keeping only their best score (best-per-wallet). Returns nothing; a
    /// score too low to make the cut is simply dropped.
    pub fn insert(&mut self, player: Pubkey, score: u32) {
        let len = self.count as usize;

        // If the player already has an entry, only keep the higher score.
        for i in 0..len {
            if self.entries[i].player == player {
                if score > self.entries[i].score {
                    self.entries[i].score = score;
                    self.resort();
                }
                return;
            }
        }

        // New player. If there's room, append; otherwise replace the lowest
        // entry but only if we beat it.
        if len < MAX_HIGHSCORE_ENTRIES {
            self.entries[len] = HighscoreEntry { player, score };
            self.count += 1;
            self.resort();
        } else {
            // List is full: the last entry is the smallest (list stays sorted).
            let last = MAX_HIGHSCORE_ENTRIES - 1;
            if score > self.entries[last].score {
                self.entries[last] = HighscoreEntry { player, score };
                self.resort();
            }
        }
    }

    /// Insertion-sort the populated prefix descending by score. N is tiny
    /// (<= 10) so this is cheap and deterministic.
    fn resort(&mut self) {
        let len = self.count as usize;
        let mut i = 1;
        while i < len {
            let mut j = i;
            while j > 0 && self.entries[j].score > self.entries[j - 1].score {
                self.entries.swap(j, j - 1);
                j -= 1;
            }
            i += 1;
        }
    }

    /// The current leader (highest score), or None if the list is empty.
    pub fn leader(&self) -> Option<HighscoreEntry> {
        if self.count == 0 {
            None
        } else {
            Some(self.entries[0])
        }
    }

    /// Clear all entries and stamp the reset time.
    pub fn clear(&mut self, now: i64) {
        self.count = 0;
        self.last_reset = now;
        self.entries = [HighscoreEntry::default(); MAX_HIGHSCORE_ENTRIES];
    }
}
