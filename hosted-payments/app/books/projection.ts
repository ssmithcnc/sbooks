// Read-only projection matching app.py /api/projection and exact-payday card snapshots.
// Payloads are heterogeneous SQLite rows, not a writable domain model.
export type Data = Record<string, any>;
export type BookRow = { sync_id: string; entity: string; payload: Data };
export const records = (rows: BookRow[], entity: string): Data[] => rows.filter(r => r.entity === entity).map(r => r.payload);
const addDays = (day: string, count: number) => new Date(Date.parse(day + "T00:00:00Z") + count * 86400000).toISOString().slice(0,10);
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function project(rows: BookRow[]) {
  const accounts = records(rows, "accounts").sort((a,b) => a.id-b.id);
  const settings = accounts[0]?.planner_settings;
  if (!settings?.anchor_date) return { periods: [] as Data[], settings: null };
  const from = settings.anchor_date;
  const to = addDays(from, Number(settings.horizon_days || 365));
  const primary = records(rows,"paychecks").filter(p => Number(p.account_id) === Number(settings.paycheck_account_id || 1)).sort((a,b) => a.date.localeCompare(b.date));
  const txs = records(rows,"transactions").filter(t => t.effective_date >= addDays(from,-1) && t.effective_date <= addDays(to,1));
  const anchors = records(rows,"account_anchors").filter(a => a.anchor_date === from);
  const balance = new Map(accounts.map(a => [a.id, Number(anchors.find(x => x.account_id === a.id)?.anchor_balance || 0)]));
  const archived = new Set(records(rows,"pay_period_archives").map(a => a.start_date));
  const snapshots = records(rows,"cc_snapshots").sort((a,b) => a.id-b.id);
  function cards(day: string, side: string) {
    const all = snapshots.filter(c => c.side === side);
    const defs = all.filter(c => c.snapshot_date === "0000-00-00");
    const names = [...new Set((defs.length ? defs : all).map(c => c.name))].sort();
    const list = names.map(name => {
      const exact = all.find(c => c.name === name && c.snapshot_date === day);
      const history = all.filter(c => c.name === name && c.snapshot_date <= day).sort((a,b) => b.snapshot_date.localeCompare(a.snapshot_date));
      return { ...exact, name, balance: Number(exact?.balance || 0), due_day: history.find(c => c.due_day)?.due_day,
        url: exact?.url || history.find(c => c.url)?.url, pay_status: exact?.pay_status || "planned" };
    });
    return { cards: list, total: round(list.reduce((s,c) => s+c.balance,0)) };
  }
  const periods: Data[] = [];
  primary.forEach((paycheck,index) => {
    const start = paycheck.date;
    const end = primary[index+1] ? addDays(primary[index+1].date,-1) : addDays(start,13);
    if (end < from || start > to) return;
    const periodAccounts = accounts.map(account => {
      const startBalance = balance.get(account.id) || 0;
      let bal = startBalance;
      const days: Data[] = [];
      for (let date = start; date <= end; date = addDays(date,1)) {
        const items = txs.filter(t => t.account_id === account.id && t.effective_date === date);
        if (paycheck.account_id === account.id && date === start) items.push({id:`paycheck-${paycheck.id}`,description:"Paycheck",amount:paycheck.amount,status:"planned",sort_key:-999});
        items.sort((a,b) => Number(a.sort_key || 0)-Number(b.sort_key || 0) || String(a.id).localeCompare(String(b.id)));
        const before = bal;
        items.forEach(item => { bal += Number(item.amount); });
        days.push({ date, items, balance:round(bal),start_balance:round(before) });
      }
      balance.set(account.id,bal);
      return {account_id:account.id,account_name:account.name,start_balance:round(startBalance),end_balance:round(bal),days};
    });
    if (!archived.has(start)) periods.push({start_date:start,end_date:end,paycheck,accounts:periodAccounts,
      three_paycheck_month:primary.filter(p => p.date.slice(0,7)===start.slice(0,7)).length===3,
      cc:cards(start,"personal"),cc_biz:cards(start,"business")});
  });
  return {periods,settings};
}
