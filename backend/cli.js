// cli.js
import readline from "readline";
import axios from "axios";

const API_URL = "http://localhost:4000/chat";

let history = [];

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "You > ",
});

console.log("🤖 Terminal AI Assistant");
console.log(
  "Type your message and press Enter. Type 'exit' or 'quit' to leave.\n"
);

rl.prompt();

rl.on("line", async (line) => {
  const message = line.trim();
  if (!message) {
    rl.prompt();
    return;
  }

  if (["exit", "quit"].includes(message.toLowerCase())) {
    console.log("Bye! 👋");
    rl.close();
    return;
  }

  try {
    // send to Express server
    const res = await axios.post(API_URL, {
      query: message,
      history,
    });

    const { reply, history: newHistory } = res.data;
    history = newHistory || history;

    console.log(`AI  > ${reply}\n`);
  } catch (err) {
    console.error(
      "Error talking to server:",
      err.response?.data || err.message
    );
  }

  rl.prompt();
});

rl.on("close", () => {
  process.exit(0);
});
