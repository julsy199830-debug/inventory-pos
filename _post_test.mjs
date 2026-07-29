// Post the createEmployee Server Action mimicking real browser RSC headers.
const ACTION_ID = "4021bb7eddbf79f0bed2f52358c734860bf42008c3";
const ROUTE = "/employees";
const EMAIL = `browserlike_${process.env.RND ?? "x"}@test.com`;

const fd = new FormData();
fd.set(ACTION_ID, "");
fd.set("$ACTION_1", "createEmployee");
fd.set("name", "Browserlike User");
fd.set("email", EMAIL);
fd.set("pin", "1234");
fd.set("role", "CASHIER");

const headers = {
  "Next-Action": ACTION_ID,
  "Accept": "text/x-component",
  // Headers a real browser sends on an RSC action POST (after a client nav).
  "Next-Router-State-Tree": "%5B%22%22%2C%7B%22children%22%3A%5B%22employees%22%2C%7B%7D%5D%7D%2Cnull%2Cnull%2Ctrue%5D",
  "Next-URL": ROUTE,
};

const url = `http://localhost:3000${ROUTE}`;
const res = await fetch(url, {
  method: "POST",
  headers,
  body: fd,
});
console.log("HTTP", res.status);
const text = await res.text();
console.log("RESP:", text.slice(0, 1800));
console.log("email used:", EMAIL);
