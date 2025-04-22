克隆环境：

git clone https://github.com/caitoudo/PriorAutobot

定位：

cd PriorAutobot

安装依赖:

npm install blessed ethers figlet dotenv

新建env:

nano .env

RPC_URL=https://sepolia.base.org

PRIVATE_KEYS="0x....,0x....."

运行：

node PriorAutobot.js
