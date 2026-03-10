const { commands } = require('../commands');

async function handle(commandName, args, message) {
  const command = commands.get(commandName.toLowerCase());
  if (!command) return;

  try {
    await command.execute(args, message);
  } catch (err) {
    console.error(`Error executing command "${commandName}":`, err);
    message.channel.send('An error occurred while running that command.');
  }
}

module.exports = { handle, commands };
