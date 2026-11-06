// Playwright selects the offered subprotocol. Model receiver processing and
// acknowledge only after recording input, while supporting legacy profilers.
export function recordInput(ws, data, packets = []) {
 const wrapped=data[0]===17;
 const input=wrapped?data.subarray(3):data;
 packets.push([...input]);
 if(input[0]===8)ws.send('pong');
 if(wrapped)ws.send(data.subarray(0,3));
}
