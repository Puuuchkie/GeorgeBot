const { ROLES } = require('../util/constants');

const FULL_PERMS = [ROLES.OWNER, ROLES.MODERATOR];
const PERMS = [ROLES.OWNER, ROLES.MODERATOR, ROLES.MEMBER, ROLES.BOTS];

/**
 * Returns the permission level of a guild member.
 * 2 = Owner or Moderator
 * 1 = Owner, Moderator, Member, or Bots
 * 0 = no qualifying role
 */
function getPermLevel(member) {
  const roleNames = member.roles.cache.map((r) => r.name);

  if (FULL_PERMS.some((r) => roleNames.includes(r))) return 2;
  if (PERMS.some((r) => roleNames.includes(r))) return 1;
  return 0;
}

/**
 * Checks if a member meets the required permission level.
 * Sends an error message to the channel if they don't.
 */
function checkPerms(member, channel, required) {
  const level = getPermLevel(member);
  if (level >= required) return true;

  channel.send(
    `\`\`\`You do not have permission to use this command.\`\`\``
  );
  return false;
}

module.exports = { getPermLevel, checkPerms };
