/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/lumberjack.json`.
 */
export type Lumberjack = {
  "address": "td8VwogVVaauJYMNYWEsagCHiX7P3imLC2kuW23rZkm",
  "metadata": {
    "name": "lumberjack",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "advanceGame",
      "discriminator": [
        16,
        234,
        160,
        159,
        114,
        118,
        208,
        167
      ],
      "accounts": [
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "highscore",
          "docs": [
            "Global highscore list (singleton PDA). Passed on every advance so the",
            "game loop can record the final score automatically the tick the game",
            "ends. Only mutated on that terminal tick; otherwise untouched."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  103,
                  104,
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "`lib.rs` verifies it matches the board's stored authority."
          ]
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "requestedTicks",
          "type": "u16"
        },
        {
          "name": "counter",
          "type": "u16"
        }
      ]
    },
    {
      "name": "chopTree",
      "discriminator": [
        120,
        56,
        196,
        91,
        213,
        182,
        36,
        28
      ],
      "accounts": [
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.authority",
                "account": "PlayerData"
              }
            ]
          }
        },
        {
          "name": "gameData",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "level_seed"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "levelSeed",
          "type": "string"
        },
        {
          "name": "counter",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initBoard",
      "discriminator": [
        99,
        74,
        129,
        223,
        26,
        254,
        94,
        217
      ],
      "accounts": [
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "feeWallet",
          "writable": true
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initHighscore",
      "discriminator": [
        220,
        36,
        227,
        31,
        10,
        102,
        88,
        211
      ],
      "accounts": [
        {
          "name": "highscore",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  103,
                  104,
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initPlayer",
      "discriminator": [
        114,
        27,
        219,
        144,
        50,
        15,
        228,
        66
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "gameData",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "level_seed"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "levelSeed",
          "type": "string"
        }
      ]
    },
    {
      "name": "initPool",
      "discriminator": [
        116,
        233,
        199,
        204,
        115,
        159,
        171,
        36
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "placeTower",
      "discriminator": [
        253,
        244,
        3,
        26,
        124,
        32,
        240,
        52
      ],
      "accounts": [
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "lib.rs verifies it matches the board's stored authority."
          ]
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "x",
          "type": "u8"
        },
        {
          "name": "y",
          "type": "u8"
        },
        {
          "name": "kind",
          "type": "u8"
        }
      ]
    },
    {
      "name": "resetBoard",
      "discriminator": [
        73,
        15,
        91,
        25,
        121,
        230,
        47,
        129
      ],
      "accounts": [
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "feeWallet",
          "writable": true
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "resetHighscore",
      "discriminator": [
        132,
        89,
        243,
        27,
        30,
        167,
        176,
        18
      ],
      "accounts": [
        {
          "name": "highscore",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  103,
                  104,
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "spawnWave",
      "discriminator": [
        116,
        168,
        108,
        128,
        23,
        205,
        241,
        90
      ],
      "accounts": [
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "count",
          "type": "u8"
        }
      ]
    },
    {
      "name": "upgradeTower",
      "discriminator": [
        254,
        127,
        46,
        180,
        70,
        242,
        152,
        92
      ],
      "accounts": [
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "lib.rs verifies it matches the board's stored authority."
          ]
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "towerIndex",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "board",
      "discriminator": [
        79,
        48,
        160,
        63,
        153,
        132,
        240,
        56
      ]
    },
    {
      "name": "gameData",
      "discriminator": [
        237,
        88,
        58,
        243,
        16,
        69,
        238,
        190
      ]
    },
    {
      "name": "highscore",
      "discriminator": [
        129,
        239,
        224,
        86,
        128,
        44,
        234,
        161
      ]
    },
    {
      "name": "playerData",
      "discriminator": [
        197,
        65,
        216,
        202,
        43,
        139,
        147,
        128
      ]
    },
    {
      "name": "pricepool",
      "discriminator": [
        83,
        113,
        229,
        106,
        61,
        247,
        85,
        111
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notEnoughEnergy",
      "msg": "Not enough energy"
    },
    {
      "code": 6001,
      "name": "wrongAuthority",
      "msg": "Wrong Authority"
    },
    {
      "code": 6002,
      "name": "pathTooLong",
      "msg": "Path exceeds the maximum length"
    },
    {
      "code": 6003,
      "name": "outOfBounds",
      "msg": "Tile is out of the grid bounds"
    },
    {
      "code": 6004,
      "name": "tileOccupied",
      "msg": "Tile is already occupied by a tower"
    },
    {
      "code": 6005,
      "name": "towerLimitReached",
      "msg": "No free tower slots on the board"
    },
    {
      "code": 6006,
      "name": "invalidTower",
      "msg": "Tower index is invalid"
    },
    {
      "code": 6007,
      "name": "notEnoughGold",
      "msg": "Not enough gold"
    },
    {
      "code": 6008,
      "name": "unitLimitReached",
      "msg": "No free unit slots on the board"
    },
    {
      "code": 6009,
      "name": "gameOver",
      "msg": "The game is over"
    },
    {
      "code": 6010,
      "name": "towerNotReady",
      "msg": "Tower is still building and not yet active"
    },
    {
      "code": 6011,
      "name": "gameNotOver",
      "msg": "The game is not over yet"
    },
    {
      "code": 6012,
      "name": "resetTooSoon",
      "msg": "The highscore was reset too recently - try again later"
    },
    {
      "code": 6013,
      "name": "emptyHighscore",
      "msg": "The highscore list is empty - nothing to pay out"
    },
    {
      "code": 6014,
      "name": "wrongFeeWallet",
      "msg": "Wrong fee wallet"
    },
    {
      "code": 6015,
      "name": "wrongPool",
      "msg": "Wrong prize pool account"
    },
    {
      "code": 6016,
      "name": "wrongWinner",
      "msg": "The provided winner is not the current highscore leader"
    },
    {
      "code": 6017,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "board",
      "docs": [
        "The full game board. Zero-copy so it can be large and cheap to touch."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "currentTick",
            "type": "u64"
          },
          {
            "name": "lastTickTimestamp",
            "type": "i64"
          },
          {
            "name": "lastId",
            "type": "u16"
          },
          {
            "name": "gridSize",
            "type": "u8"
          },
          {
            "name": "pathLen",
            "type": "u8"
          },
          {
            "name": "towerCount",
            "type": "u8"
          },
          {
            "name": "scored",
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "lives",
            "type": "u32"
          },
          {
            "name": "gold",
            "type": "u32"
          },
          {
            "name": "kills",
            "type": "u32"
          },
          {
            "name": "nextUnitId",
            "type": "u32"
          },
          {
            "name": "waveNumber",
            "type": "u32"
          },
          {
            "name": "pad1",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "nextWaveTick",
            "type": "u64"
          },
          {
            "name": "path",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "pathPoint"
                  }
                },
                64
              ]
            }
          },
          {
            "name": "towers",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "tower"
                  }
                },
                16
              ]
            }
          },
          {
            "name": "units",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "unit"
                  }
                },
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "gameData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalWoodCollected",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "highscore",
      "docs": [
        "Global highscore list (a singleton PDA). Keeps the top-N wallets by score",
        "for the current period, sorted descending. `last_reset` gates how often the",
        "list can be reset + the jackpot paid out."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "count",
            "docs": [
              "Number of populated entries in `entries` (<= MAX_HIGHSCORE_ENTRIES)."
            ],
            "type": "u32"
          },
          {
            "name": "lastReset",
            "docs": [
              "Unix timestamp of the last reset/payout (0 until first reset)."
            ],
            "type": "i64"
          },
          {
            "name": "entries",
            "docs": [
              "Top scores, descending. Only the first `count` are meaningful."
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "highscoreEntry"
                  }
                },
                10
              ]
            }
          }
        ]
      }
    },
    {
      "name": "highscoreEntry",
      "docs": [
        "A single highscore row: the player's main wallet and their best kills in a",
        "single game during the current period."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "score",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "pathPoint",
      "docs": [
        "A single waypoint on the deterministic path, in grid tile coordinates."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "x",
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "playerData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "xp",
            "type": "u64"
          },
          {
            "name": "wood",
            "type": "u64"
          },
          {
            "name": "energy",
            "type": "u64"
          },
          {
            "name": "lastLogin",
            "type": "i64"
          },
          {
            "name": "lastId",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "pricepool",
      "docs": [
        "The jackpot pool. A PROGRAM-OWNED, zero-data PDA (seeds `[\"price_pool\"]`)",
        "that escrows entry fees. Mirrors solana-2048's `Pricepool`. Being owned by",
        "this program (not the System Program) is what lets `reset_highscore`",
        "direct-debit lamports out to winners. It carries no fields; the account just",
        "needs to exist and hold lamports."
      ],
      "type": {
        "kind": "struct",
        "fields": []
      }
    },
    {
      "name": "sessionToken",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "targetProgram",
            "type": "pubkey"
          },
          {
            "name": "sessionSigner",
            "type": "pubkey"
          },
          {
            "name": "validUntil",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tower",
      "docs": [
        "A tower placed on the grid.",
        "",
        "Upgrades are deferred like the initial build: the boosted stats are stored",
        "in the `pending_*` fields and only committed once `current_tick` reaches",
        "`ready_at_tick`. Until then the tower keeps shooting with its current",
        "(pre-upgrade) stats. `pending_level == 0` means \"no pending upgrade\"."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "x",
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u8"
          },
          {
            "name": "rangeSubtiles",
            "type": "u32"
          },
          {
            "name": "damage",
            "type": "u32"
          },
          {
            "name": "cooldownTicks",
            "type": "u32"
          },
          {
            "name": "pendingLevel",
            "type": "u8"
          },
          {
            "name": "pad2",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "pendingDamage",
            "type": "u32"
          },
          {
            "name": "pendingRangeSubtiles",
            "type": "u32"
          },
          {
            "name": "splashRadiusSubtiles",
            "type": "u32"
          },
          {
            "name": "lastShotTick",
            "type": "u64"
          },
          {
            "name": "readyAtTick",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "unit",
      "docs": [
        "A moving enemy unit. Position is a scalar offset along the path measured in",
        "sub-tiles from the first waypoint. Fully deterministic given (spawn_tick,",
        "speed, current_tick)."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "state",
            "type": "u8"
          },
          {
            "name": "enemyKind",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "speedSubtiles",
            "type": "u32"
          },
          {
            "name": "hp",
            "type": "u32"
          },
          {
            "name": "maxHp",
            "type": "u32"
          },
          {
            "name": "reward",
            "type": "u32"
          },
          {
            "name": "slowedUntilTick",
            "type": "u32"
          },
          {
            "name": "spawnTick",
            "type": "u64"
          },
          {
            "name": "progressSubtiles",
            "type": "u64"
          }
        ]
      }
    }
  ]
}

export const IDL: Lumberjack = {
  "address": "td8VwogVVaauJYMNYWEsagCHiX7P3imLC2kuW23rZkm",
  "metadata": {
    "name": "lumberjack",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "advanceGame",
      "discriminator": [
        16,
        234,
        160,
        159,
        114,
        118,
        208,
        167
      ],
      "accounts": [
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "highscore",
          "docs": [
            "Global highscore list (singleton PDA). Passed on every advance so the",
            "game loop can record the final score automatically the tick the game",
            "ends. Only mutated on that terminal tick; otherwise untouched."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  103,
                  104,
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "`lib.rs` verifies it matches the board's stored authority."
          ]
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "requestedTicks",
          "type": "u16"
        },
        {
          "name": "counter",
          "type": "u16"
        }
      ]
    },
    {
      "name": "chopTree",
      "discriminator": [
        120,
        56,
        196,
        91,
        213,
        182,
        36,
        28
      ],
      "accounts": [
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "player.authority",
                "account": "PlayerData"
              }
            ]
          }
        },
        {
          "name": "gameData",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "level_seed"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "levelSeed",
          "type": "string"
        },
        {
          "name": "counter",
          "type": "u16"
        }
      ]
    },
    {
      "name": "initBoard",
      "discriminator": [
        99,
        74,
        129,
        223,
        26,
        254,
        94,
        217
      ],
      "accounts": [
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "feeWallet",
          "writable": true
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initHighscore",
      "discriminator": [
        220,
        36,
        227,
        31,
        10,
        102,
        88,
        211
      ],
      "accounts": [
        {
          "name": "highscore",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  103,
                  104,
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initPlayer",
      "discriminator": [
        114,
        27,
        219,
        144,
        50,
        15,
        228,
        66
      ],
      "accounts": [
        {
          "name": "player",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  121,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "gameData",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "arg",
                "path": "level_seed"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "levelSeed",
          "type": "string"
        }
      ]
    },
    {
      "name": "initPool",
      "discriminator": [
        116,
        233,
        199,
        204,
        115,
        159,
        171,
        36
      ],
      "accounts": [
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "placeTower",
      "discriminator": [
        253,
        244,
        3,
        26,
        124,
        32,
        240,
        52
      ],
      "accounts": [
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "lib.rs verifies it matches the board's stored authority."
          ]
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "x",
          "type": "u8"
        },
        {
          "name": "y",
          "type": "u8"
        },
        {
          "name": "kind",
          "type": "u8"
        }
      ]
    },
    {
      "name": "resetBoard",
      "discriminator": [
        73,
        15,
        91,
        25,
        121,
        230,
        47,
        129
      ],
      "accounts": [
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "feeWallet",
          "writable": true
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "resetHighscore",
      "discriminator": [
        132,
        89,
        243,
        27,
        30,
        167,
        176,
        18
      ],
      "accounts": [
        {
          "name": "highscore",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  104,
                  105,
                  103,
                  104,
                  115,
                  99,
                  111,
                  114,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "pool",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  114,
                  105,
                  99,
                  101,
                  95,
                  112,
                  111,
                  111,
                  108
                ]
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "spawnWave",
      "discriminator": [
        116,
        168,
        108,
        128,
        23,
        205,
        241,
        90
      ],
      "accounts": [
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "signer"
              }
            ]
          }
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "count",
          "type": "u8"
        }
      ]
    },
    {
      "name": "upgradeTower",
      "discriminator": [
        254,
        127,
        46,
        180,
        70,
        242,
        152,
        92
      ],
      "accounts": [
        {
          "name": "sessionToken",
          "optional": true
        },
        {
          "name": "board",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  97,
                  114,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "docs": [
            "lib.rs verifies it matches the board's stored authority."
          ]
        },
        {
          "name": "signer",
          "writable": true,
          "signer": true
        }
      ],
      "args": [
        {
          "name": "towerIndex",
          "type": "u8"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "board",
      "discriminator": [
        79,
        48,
        160,
        63,
        153,
        132,
        240,
        56
      ]
    },
    {
      "name": "gameData",
      "discriminator": [
        237,
        88,
        58,
        243,
        16,
        69,
        238,
        190
      ]
    },
    {
      "name": "highscore",
      "discriminator": [
        129,
        239,
        224,
        86,
        128,
        44,
        234,
        161
      ]
    },
    {
      "name": "playerData",
      "discriminator": [
        197,
        65,
        216,
        202,
        43,
        139,
        147,
        128
      ]
    },
    {
      "name": "pricepool",
      "discriminator": [
        83,
        113,
        229,
        106,
        61,
        247,
        85,
        111
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notEnoughEnergy",
      "msg": "Not enough energy"
    },
    {
      "code": 6001,
      "name": "wrongAuthority",
      "msg": "Wrong Authority"
    },
    {
      "code": 6002,
      "name": "pathTooLong",
      "msg": "Path exceeds the maximum length"
    },
    {
      "code": 6003,
      "name": "outOfBounds",
      "msg": "Tile is out of the grid bounds"
    },
    {
      "code": 6004,
      "name": "tileOccupied",
      "msg": "Tile is already occupied by a tower"
    },
    {
      "code": 6005,
      "name": "towerLimitReached",
      "msg": "No free tower slots on the board"
    },
    {
      "code": 6006,
      "name": "invalidTower",
      "msg": "Tower index is invalid"
    },
    {
      "code": 6007,
      "name": "notEnoughGold",
      "msg": "Not enough gold"
    },
    {
      "code": 6008,
      "name": "unitLimitReached",
      "msg": "No free unit slots on the board"
    },
    {
      "code": 6009,
      "name": "gameOver",
      "msg": "The game is over"
    },
    {
      "code": 6010,
      "name": "towerNotReady",
      "msg": "Tower is still building and not yet active"
    },
    {
      "code": 6011,
      "name": "gameNotOver",
      "msg": "The game is not over yet"
    },
    {
      "code": 6012,
      "name": "resetTooSoon",
      "msg": "The highscore was reset too recently - try again later"
    },
    {
      "code": 6013,
      "name": "emptyHighscore",
      "msg": "The highscore list is empty - nothing to pay out"
    },
    {
      "code": 6014,
      "name": "wrongFeeWallet",
      "msg": "Wrong fee wallet"
    },
    {
      "code": 6015,
      "name": "wrongPool",
      "msg": "Wrong prize pool account"
    },
    {
      "code": 6016,
      "name": "wrongWinner",
      "msg": "The provided winner is not the current highscore leader"
    },
    {
      "code": 6017,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "board",
      "docs": [
        "The full game board. Zero-copy so it can be large and cheap to touch."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "currentTick",
            "type": "u64"
          },
          {
            "name": "lastTickTimestamp",
            "type": "i64"
          },
          {
            "name": "lastId",
            "type": "u16"
          },
          {
            "name": "gridSize",
            "type": "u8"
          },
          {
            "name": "pathLen",
            "type": "u8"
          },
          {
            "name": "towerCount",
            "type": "u8"
          },
          {
            "name": "scored",
            "type": "u8"
          },
          {
            "name": "pad0",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "lives",
            "type": "u32"
          },
          {
            "name": "gold",
            "type": "u32"
          },
          {
            "name": "kills",
            "type": "u32"
          },
          {
            "name": "nextUnitId",
            "type": "u32"
          },
          {
            "name": "waveNumber",
            "type": "u32"
          },
          {
            "name": "pad1",
            "type": {
              "array": [
                "u8",
                4
              ]
            }
          },
          {
            "name": "nextWaveTick",
            "type": "u64"
          },
          {
            "name": "path",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "pathPoint"
                  }
                },
                64
              ]
            }
          },
          {
            "name": "towers",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "tower"
                  }
                },
                16
              ]
            }
          },
          {
            "name": "units",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "unit"
                  }
                },
                16
              ]
            }
          }
        ]
      }
    },
    {
      "name": "gameData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "totalWoodCollected",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "highscore",
      "docs": [
        "Global highscore list (a singleton PDA). Keeps the top-N wallets by score",
        "for the current period, sorted descending. `last_reset` gates how often the",
        "list can be reset + the jackpot paid out."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "count",
            "docs": [
              "Number of populated entries in `entries` (<= MAX_HIGHSCORE_ENTRIES)."
            ],
            "type": "u32"
          },
          {
            "name": "lastReset",
            "docs": [
              "Unix timestamp of the last reset/payout (0 until first reset)."
            ],
            "type": "i64"
          },
          {
            "name": "entries",
            "docs": [
              "Top scores, descending. Only the first `count` are meaningful."
            ],
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "highscoreEntry"
                  }
                },
                10
              ]
            }
          }
        ]
      }
    },
    {
      "name": "highscoreEntry",
      "docs": [
        "A single highscore row: the player's main wallet and their best kills in a",
        "single game during the current period."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "score",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "pathPoint",
      "docs": [
        "A single waypoint on the deterministic path, in grid tile coordinates."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "x",
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          }
        ]
      }
    },
    {
      "name": "playerData",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "name",
            "type": "string"
          },
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "xp",
            "type": "u64"
          },
          {
            "name": "wood",
            "type": "u64"
          },
          {
            "name": "energy",
            "type": "u64"
          },
          {
            "name": "lastLogin",
            "type": "i64"
          },
          {
            "name": "lastId",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "pricepool",
      "docs": [
        "The jackpot pool. A PROGRAM-OWNED, zero-data PDA (seeds `[\"price_pool\"]`)",
        "that escrows entry fees. Mirrors solana-2048's `Pricepool`. Being owned by",
        "this program (not the System Program) is what lets `reset_highscore`",
        "direct-debit lamports out to winners. It carries no fields; the account just",
        "needs to exist and hold lamports."
      ],
      "type": {
        "kind": "struct",
        "fields": []
      }
    },
    {
      "name": "sessionToken",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "targetProgram",
            "type": "pubkey"
          },
          {
            "name": "sessionSigner",
            "type": "pubkey"
          },
          {
            "name": "validUntil",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "tower",
      "docs": [
        "A tower placed on the grid.",
        "",
        "Upgrades are deferred like the initial build: the boosted stats are stored",
        "in the `pending_*` fields and only committed once `current_tick` reaches",
        "`ready_at_tick`. Until then the tower keeps shooting with its current",
        "(pre-upgrade) stats. `pending_level == 0` means \"no pending upgrade\"."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "kind",
            "type": "u8"
          },
          {
            "name": "level",
            "type": "u8"
          },
          {
            "name": "x",
            "type": "u8"
          },
          {
            "name": "y",
            "type": "u8"
          },
          {
            "name": "rangeSubtiles",
            "type": "u32"
          },
          {
            "name": "damage",
            "type": "u32"
          },
          {
            "name": "cooldownTicks",
            "type": "u32"
          },
          {
            "name": "pendingLevel",
            "type": "u8"
          },
          {
            "name": "pad2",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "pendingDamage",
            "type": "u32"
          },
          {
            "name": "pendingRangeSubtiles",
            "type": "u32"
          },
          {
            "name": "splashRadiusSubtiles",
            "type": "u32"
          },
          {
            "name": "lastShotTick",
            "type": "u64"
          },
          {
            "name": "readyAtTick",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "unit",
      "docs": [
        "A moving enemy unit. Position is a scalar offset along the path measured in",
        "sub-tiles from the first waypoint. Fully deterministic given (spawn_tick,",
        "speed, current_tick)."
      ],
      "serialization": "bytemuck",
      "repr": {
        "kind": "c"
      },
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "state",
            "type": "u8"
          },
          {
            "name": "enemyKind",
            "type": "u8"
          },
          {
            "name": "pad",
            "type": {
              "array": [
                "u8",
                2
              ]
            }
          },
          {
            "name": "speedSubtiles",
            "type": "u32"
          },
          {
            "name": "hp",
            "type": "u32"
          },
          {
            "name": "maxHp",
            "type": "u32"
          },
          {
            "name": "reward",
            "type": "u32"
          },
          {
            "name": "slowedUntilTick",
            "type": "u32"
          },
          {
            "name": "spawnTick",
            "type": "u64"
          },
          {
            "name": "progressSubtiles",
            "type": "u64"
          }
        ]
      }
    }
  ]
} as const as Lumberjack
