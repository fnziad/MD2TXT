// server/api/index.ts
function handler(_req, res) {
  res.status(200).json({ status: "ok", service: "md2txt" });
}
export {
  handler as default
};
