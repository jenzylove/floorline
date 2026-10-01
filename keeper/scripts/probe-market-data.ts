import WebSocket from "ws";
const ws = new WebSocket("wss://app.perpl.xyz/ws/v1/market-data");
const seen: Record<number, number> = {};
ws.on("open", () => {
  ws.send(JSON.stringify({ mt: 5, subs: [
    { stream: "heartbeat@143", subscribe: true },
    { stream: "market-state@143", subscribe: true },
    { stream: "funding@143", subscribe: true },
    { stream: "order-book@10", subscribe: true },
  ] }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw.toString());
  seen[m.mt] = (seen[m.mt] ?? 0) + 1;
  if (seen[m.mt] === 1) console.log(JSON.stringify(m).slice(0, 400));
});
setTimeout(() => { console.log("counts", seen); ws.close(); process.exit(0); }, 8000);
