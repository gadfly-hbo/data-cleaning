import { createWriteStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../workspace/messy-100mb.csv",
);

const cities = ["北京 朝阳区", "北京市朝阳区", "上海", "上海市", "广州", "广州市", "Shenzhen", "shenzhen ", "杭州", "成都"];
const first = ["张伟", "zhang wei", " 李娜", "LI Na ", "王芳", " Michael Chen", "赵敏", "陈静", "刘洋", "杨静"];

function row(i) {
  const name = `" ${first[i % first.length]} "`;
  const phone = i % 7 === 0 ? "" : `1${String(3800000000 + (i * 7919) % 600000000)}`;
  const city = cities[i % cities.length];
  const amount = i % 3 === 0 ? `"${(i % 100000) / 10},000.50"` : String((i % 99999) / 100);
  const date = i % 2 === 0 ? `2026-0${(i % 9) + 1}-1${i % 9}` : `2026/0${(i % 9) + 1}/1${i % 9}`;
  return `${name},${phone},"${city}",${amount},${date}\n`;
}

const header = "name,phone,city,amount,created_at\n";
const ws = createWriteStream(OUT);
ws.write(header);
let written = header.length;
let i = 0;
const TARGET = 100 * 1024 * 1024; // 100MB
const buf = [];
let bufLen = 0;
while (written < TARGET) {
  const line = row(i++);
  buf.push(line);
  bufLen += line.length;
  written += Buffer.byteLength(line);
  if (bufLen > 1 << 20) {
    ws.write(buf.join(""));
    buf.length = 0;
    bufLen = 0;
  }
}
ws.write(buf.join(""));
ws.end();
ws.on("finish", () => {
  console.log(JSON.stringify({ file: OUT, rows: i, bytes: written }));
});
