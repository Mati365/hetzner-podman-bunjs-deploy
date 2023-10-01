const server = Bun.serve({
  port: process.env.SERVER_PORT,
  fetch: () => new Response(process.env.YOUR_MESSAGE),
});

console.log(`Listening on localhost: ${server.port}`);
