import Dexie from 'dexie';

export const db = new Dexie('EdgeLabDB');

db.version(1).stores({
  strategie: '++id, nome, stato',
  conti: '++id, nome, tipo',
  trade: '++id, conto_id, strategia_id, asset, data_apertura, r_result'
});

// Version 2: aggiunge created_at e draft
db.version(2).stores({
  strategie: '++id, nome, stato',
  conti: '++id, nome, tipo',
  trade: '++id, conto_id, strategia_id, asset, data_apertura, created_at, r_result, draft'
}).upgrade(async tx => {
  const trades = await tx.table('trade').toArray();
  for (const trade of trades) {
    await tx.table('trade').update(trade.id, {
      created_at: trade.data_chiusura || trade.data_apertura || new Date().toISOString(),
      draft: false
    });
  }
});

// Version 3: aggiunge tabelle backtest
db.version(3).stores({
  strategie: '++id, nome, stato',
  conti: '++id, nome, tipo',
  trade: '++id, conto_id, strategia_id, asset, data_apertura, created_at, r_result, draft',
  bt_progetti: '++id, nome, asset, created_at',
  bt_trade: '++id, progetto_id, data_apertura, r_result'
});