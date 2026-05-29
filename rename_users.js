const fs = require('fs');
const readline = require('readline');
const { Client, GatewayIntentBits } = require('discord.js');
require('dotenv').config();

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !guildId) {
    console.error("Error: DISCORD_TOKEN or DISCORD_GUILD_ID is not set in .env file.");
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}

async function getManualInput() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const mappings = new Map();
    console.log("\n--- Ввод данных вручную ---");
    console.log("Вводите никнейм и ID через пробел (например: PlayerName 123456789012345).");
    console.log("Для завершения ввода просто нажмите Enter на пустой строке.\n");

    let count = 0;
    while (true) {
        count++;
        const answer = await new Promise(resolve => rl.question(`[${count}] Ник и ID: `, resolve));
        const trimmed = answer.trim();
        if (!trimmed) {
            break;
        }

        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) {
            console.log("Warning: Некорректный формат. Нужно ввести ник и ID через пробел.");
            count--;
            continue;
        }

        const discordId = parts[parts.length - 1];
        const nickname = parts.slice(0, -1).join(' ');

        if (!/^\d+$/.test(discordId)) {
            console.log(`Warning: Некорректный Discord ID: '${discordId}'. Он должен состоять только из цифр.`);
            count--;
            continue;
        }

        mappings.set(discordId, nickname);
    }
    rl.close();
    console.log(`\nВведено вручную ${mappings.size} участников.`);
    return mappings;
}

async function loadMappings() {
    const choice = await askQuestion("Выберите источник данных:\n1. Загрузить из файла\n2. Ввести вручную прямо сейчас\nВведите 1 или 2: ");
    const trimmedChoice = choice.trim();

    if (trimmedChoice === '2') {
        return await getManualInput();
    }

    const filename = process.env.LIST_FILE || 'list.txt';
    const mappings = new Map();

    if (!fs.existsSync(filename)) {
        console.error(`Error: File ${filename} not found in the current directory.`);
        return null;
    }

    const fileStream = fs.createReadStream(filename);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });

    let lineNo = 0;
    for await (const line of rl) {
        lineNo++;
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parts = trimmed.split(/\s+/);
        if (parts.length < 2) {
            console.warn(`Warning: Line ${lineNo} is malformed: '${trimmed}'`);
            continue;
        }

        const discordId = parts[parts.length - 1];
        const nickname = parts.slice(0, -1).join(' ');

        if (!/^\d+$/.test(discordId)) {
            console.warn(`Warning: Line ${lineNo} has an invalid Discord ID: '${discordId}'`);
            continue;
        }

        mappings.set(discordId, nickname);
    }

    console.log(`Loaded ${mappings.size} mappings from ${filename}.`);
    return mappings;
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag} (${client.user.id})`);
    console.log("----------------------------------------");

    const mappings = await loadMappings();
    if (!mappings) {
        client.destroy();
        return;
    }

    try {
        const guild = await client.guilds.fetch(guildId);
        if (!guild) {
            console.error(`Error: Guild with ID ${guildId} not found.`);
            client.destroy();
            return;
        }

        console.log(`Connected to: ${guild.name} (${guild.id})`);
        console.log("Fetching members...");
        
        let members;
        try {
            members = await guild.members.fetch();
            console.log(`Cached ${members.size} members.`);
        } catch (e) {
            console.error(`Failed to fetch members: ${e.message}`);
        }

        console.log("Updating nicknames...");
        console.log("----------------------------------------");

        let successCount = 0;
        let skippedCount = 0;
        let notFoundCount = 0;
        let errorCount = 0;
        const notFoundMembers = [];

        for (const [discordId, targetNickname] of mappings.entries()) {
            let member;
            if (members) {
                member = members.get(discordId);
            } else {
                try {
                    member = await guild.members.fetch(discordId);
                } catch (e) {
                    member = null;
                }
            }

            if (!member) {
                console.log(`[NOT FOUND] ID ${discordId} (${targetNickname})`);
                notFoundMembers.push({ id: discordId, nickname: targetNickname });
                notFoundCount++;
                continue;
            }

            if (member.nickname === targetNickname) {
                console.log(`[SKIP] ${member.user.tag} already has nickname '${targetNickname}'`);
                skippedCount++;
                continue;
            }
            try {
                console.log(`Renaming ${member.user.tag} -> '${targetNickname}'...`);
                await member.setNickname(targetNickname);
                console.log(`  [SUCCESS] Renamed to '${targetNickname}'`);
                successCount++;
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (e) {
                console.error(`  [ERROR] Failed to rename ${member.user.tag}: ${e.message}`);
                errorCount++;
            }
        }

        console.log("----------------------------------------");
        console.log("Nickname updates completed.");
        console.log(`Summary: Success: ${successCount}, Skipped: ${skippedCount}, Not Found: ${notFoundCount}, Errors: ${errorCount}`);

        if (notFoundMembers.length > 0) {
            console.log("\n----------------------------------------");
            console.log("СПИСОК УЧАСТНИКОВ, КОТОРЫХ НЕТ НА СЕРВЕРЕ:");
            notFoundMembers.forEach(m => {
                console.log(`${m.nickname} ${m.id}`);
            });
            console.log("----------------------------------------");
        }

    } catch (e) {
        console.error(`An error occurred: ${e.message}`);
    } finally {
        client.destroy();
    }
});

client.login(token).catch(err => {
    console.error("Error: Login failed.");
    console.error(err.message);
});
