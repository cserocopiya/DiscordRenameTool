import os
import sys
import asyncio
import discord
from dotenv import load_dotenv

load_dotenv()

TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID_STR = os.getenv("DISCORD_GUILD_ID")

if not TOKEN or not GUILD_ID_STR:
    print("Error: DISCORD_TOKEN or DISCORD_GUILD_ID is not set in .env file.")
    sys.exit(1)

try:
    GUILD_ID = int(GUILD_ID_STR)
except ValueError:
    print(f"Error: DISCORD_GUILD_ID '{GUILD_ID_STR}' is not a valid integer.")
    sys.exit(1)

intents = discord.Intents.default()
intents.members = True

class RenameBot(discord.Client):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.filename = os.getenv("LIST_FILE", "list.txt")
        self.mappings = {}

    def get_manual_input(self):
        print("\n--- Ввод данных вручную ---")
        print("Вводите никнейм и ID через пробел (например: PlayerName 123456789012345).")
        print("Для завершения ввода просто нажмите Enter на пустой строке.\n")

        count = 0
        while True:
            count += 1
            try:
                val = input(f"[{count}] Ник и ID: ").strip()
            except EOFError:
                break
            if not val:
                break

            parts = val.split()
            if len(parts) < 2:
                print("Warning: Некорректный формат. Нужно ввести ник и ID через пробел.")
                count -= 1
                continue

            discord_id_str = parts[-1]
            nickname = " ".join(parts[:-1])

            if not discord_id_str.isdigit():
                print(f"Warning: Некорректный Discord ID: '{discord_id_str}'. Он должен состоять только из цифр.")
                count -= 1
                continue

            self.mappings[int(discord_id_str)] = nickname
        
        print(f"\nВведено вручную {len(self.mappings)} участников.")
        return True

    def load_mappings(self):
        print("Выберите источник данных:")
        print("1. Загрузить из файла")
        print("2. Ввести вручную прямо сейчас")
        try:
            choice = input("Введите 1 или 2: ").strip()
        except EOFError:
            choice = "1"

        if choice == "2":
            return self.get_manual_input()

        if not os.path.exists(self.filename):
            print(f"Error: File {self.filename} not found.")
            return False

        with open(self.filename, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                parts = line.split()
                if len(parts) < 2:
                    print(f"Warning: Line {line_no} is malformed: '{line}'")
                    continue
                
                discord_id_str = parts[-1]
                nickname = " ".join(parts[:-1])
                
                if not discord_id_str.isdigit():
                    print(f"Warning: Line {line_no} has an invalid Discord ID: '{discord_id_str}'")
                    continue
                
                self.mappings[int(discord_id_str)] = nickname
        
        print(f"Loaded {len(self.mappings)} mappings from {self.filename}.")
        return True

    async def on_ready(self):
        print(f"Logged in as {self.user} (ID: {self.user.id})")
        print("----------------------------------------")
        
        if not self.load_mappings():
            await self.close()
            return

        guild = self.get_guild(GUILD_ID)
        if not guild:
            print(f"Error: Guild with ID {GUILD_ID} not found.")
            await self.close()
            return
        
        print(f"Connected to: {guild.name} ({guild.id})")
        print("Fetching members...")
        
        try:
            members = {}
            async for member in guild.fetch_members(limit=None):
                members[member.id] = member
            print(f"Cached {len(members)} members.")
        except Exception as e:
            print(f"Failed to fetch members: {e}")
            members = None

        print("Updating nicknames...")
        print("----------------------------------------")
        
        success_count = 0
        skipped_count = 0
        not_found_count = 0
        error_count = 0
        not_found_members = []

        for discord_id, target_nickname in self.mappings.items():
            member = None
            if members is not None:
                member = members.get(discord_id)
            else:
                try:
                    member = await guild.fetch_member(discord_id)
                except discord.NotFound:
                    member = None
                except discord.HTTPException as e:
                    print(f"[ERROR] Fetching member {discord_id}: {e}")
                    error_count += 1
                    continue
            
            if not member:
                print(f"[NOT FOUND] ID {discord_id} ({target_nickname})")
                not_found_members.append({"id": discord_id, "nickname": target_nickname})
                not_found_count += 1
                continue

            current_nick = member.nick if member.nick else member.name
            if current_nick == target_nickname:
                print(f"[SKIP] {member.name} already has nickname '{target_nickname}'")
                skipped_count += 1
                continue

            try:
                print(f"Renaming {member.name} -> '{target_nickname}'...")
                await member.edit(nick=target_nickname)
                print(f"  [SUCCESS] Renamed to '{target_nickname}'")
                success_count += 1
                await asyncio.sleep(1.0)
            except discord.Forbidden:
                print(f"  [ERROR] Cannot change nickname for {member.name}. Bot lacks permission or member's role is higher.")
                error_count += 1
            except discord.HTTPException as e:
                print(f"  [ERROR] Failed to rename {member.name}: {e}")
                error_count += 1
                if e.status == 429:
                    retry_after = getattr(e, 'retry_after', 5.0)
                    print(f"Rate limited. Waiting for {retry_after} seconds...")
                    await asyncio.sleep(retry_after)

        print("----------------------------------------")
        print("Nickname updates completed.")
        print(f"Summary: Success: {success_count}, Skipped: {skipped_count}, Not Found: {not_found_count}, Errors: {error_count}")
        
        if not_found_members:
            print("\n----------------------------------------")
            print("СПИСОК УЧАСТНИКОВ, КОТОРЫХ НЕТ НА СЕРВЕРЕ:")
            for m in not_found_members:
                print(f"{m['nickname']} {m['id']}")
            print("----------------------------------------")
        
        await self.close()

if __name__ == "__main__":
    bot = RenameBot(intents=intents)
    try:
        bot.run(TOKEN)
    except discord.LoginFailure:
        print("Error: Login failed.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
