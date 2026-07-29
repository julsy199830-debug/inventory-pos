const ACTION_ID = process.env.AID;
const EMAIL = `save_${process.env.RND}@test.com`;
const fd = new FormData();
fd.set(ACTION_ID, "");
fd.set("$ACTION_1", "createEmployee");
fd.set("name", "Saved Employee");
fd.set("email", EMAIL);
fd.set("pin", "1234");
fd.set("role", "CASHIER");
const res = await fetch(`http://localhost:3000/employees`, {
  method: "POST",
  headers: { "Next-Action": ACTION_ID, "Accept": "text/x-component" },
  body: fd,
});
console.log("HTTP", res.status);
console.log("RESP:", (await res.text()).slice(0, 800));
console.log("email:", EMAIL);
