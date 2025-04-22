git clone https://github.com/caitoudo/PriorAutobot

cd PriorAutobot

npm install blessed ethers figlet dotenv

nano .env

RPC_URL=https://sepolia.base.org

PRIVATE_KEYS="0x....,0x....."

node PriorAutobot.js
