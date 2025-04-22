import "dotenv/config";
import blessed from "blessed";
import figlet from "figlet";
import { ethers } from "ethers";

// 多账号配置 - 从环境变量读取
const PRIVATE_KEYS = process.env.PRIVATE_KEYS.split(',');
const RPC_URL = process.env.RPC_URL;
const USDC_ADDRESS = "0x109694D75363A75317A8136D80f50F871E81044e";
const USDT_ADDRESS = "0x014397DaEa96CaC46DbEdcbce50A42D5e0152B2E";
const PRIOR_ADDRESS = "0xc19Ec2EEBB009b2422514C51F9118026f1cD89ba";
const routerAddress = "0x0f1DADEcc263eB79AE3e4db0d57c49a8b6178B0B";
const FAUCET_ADDRESS = "0xCa602D9E45E1Ed25105Ee43643ea936B8e2Fd6B7";
const NETWORK_NAME = "PRIOR TESTNET";

// 全局状态
let walletsInfo = [];
let transactionLogs = [];
let priorSwapRunning = false;
let priorSwapCancelled = false;
let autoModeRunning = false;
let autoModeCancelled = false;

// 合约ABI
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)"
];

const routerABI = [
  {
    "inputs": [
      { "internalType": "uint256", "name": "varg0", "type": "uint256" }
    ],
    "name": "swapPriorToUSDC",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "uint256", "name": "varg0", "type": "uint256" }
    ],
    "name": "swapPriorToUSDT",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
];

const FAUCET_ABI = [
  "function claimTokens() external",
  "function lastClaimTime(address) view returns (uint256)",
  "function claimCooldown() view returns (uint256)",
  "function claimAmount() view returns (uint256)"
];

// 辅助函数
function getShortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}

function addLog(message, type) {
  const timestamp = new Date().toLocaleTimeString();
  let coloredMessage = message;
  if (type === "prior") {
    coloredMessage = `{bright-magenta-fg}${message}{/bright-magenta-fg}`;
  } else if (type === "system") {
    coloredMessage = `{bright-white-fg}${message}{/bright-white-fg}`;
  } else if (type === "error") {
    coloredMessage = `{bright-red-fg}${message}{/bright-red-fg}`;
  } else if (type === "success") {
    coloredMessage = `{bright-green-fg}${message}{/bright-green-fg}`;
  } else if (type === "warning") {
    coloredMessage = `{bright-yellow-fg}${message}{/bright-yellow-fg}`;
  }
  transactionLogs.push(`{bright-cyan-fg}[{/bright-cyan-fg} {bold}{grey-fg}${timestamp}{/grey-fg}{/bold} {bright-cyan-fg}]{/bright-cyan-fg} {bold}${coloredMessage}{/bold}`);
  updateLogs();
}

function getRandomDelay() {
  return Math.random() * (60000 - 30000) + 30000;
}

function getRandomNumber(min, max) {
  return Math.random() * (max - min) + min;
}

function getShortHash(hash) {
  return hash.slice(0, 6) + "..." + hash.slice(-4);
}

function updateLogs() {
  logsBox.setContent(transactionLogs.join("\n"));
  logsBox.setScrollPerc(100);
  safeRender();
}

function clearTransactionLogs() {
  transactionLogs = [];
  updateLogs();
  addLog("Transaction logs telah dihapus.", "system");
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitWithCancel(delay, type) {
  return Promise.race([
    new Promise(resolve => setTimeout(resolve, delay)),
    new Promise(resolve => {
      const interval = setInterval(() => {
        if (type === "prior" && priorSwapCancelled) { clearInterval(interval); resolve(); }
        if (type === "auto" && autoModeCancelled) { clearInterval(interval); resolve(); }
      }, 100);
    })
  ]);
}

// UI初始化
const screen = blessed.screen({
  smartCSR: true,
  title: "Prior Swap Multi-Account",
  fullUnicode: true,
  mouse: true
});

let renderTimeout;
function safeRender() {
  if (renderTimeout) clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => { screen.render(); }, 50);
}

const headerBox = blessed.box({
  top: 0,
  left: "center",
  width: "100%",
  tags: true,
  style: { fg: "white", bg: "default" }
});

figlet.text("X:@caitoudu".toUpperCase(), { font: "ANSI Shadow", horizontalLayout: "default" }, (err, data) => {
  if (err) headerBox.setContent("{center}{bold}X:@caitoudu{/bold}{/center}");
  else headerBox.setContent(`{center}{bold}{bright-cyan-fg}${data}{/bright-cyan-fg}{/bold}{/center}`);
  safeRender();
});

const descriptionBox = blessed.box({
  left: "center",
  width: "100%",
  content: "{center}{bold}{bright-yellow-fg}                                                  « ✮  P̳̿͟͞R̳̿͟͞I̳̿͟͞O̳̿͟͞R̳̿͟͞ A̳̿͟͞U̳̿͟͞T̳̿͟͞O̳̿͟͞ B̳̿͟͞O̳̿͟͞T̳̿͟͞ ✮ »{/bright-yellow-fg}{/bold}{/center}",
  tags: true,
  style: { fg: "white", bg: "default" }
});

const logsBox = blessed.box({
  label: " Transaction Logs ",
  left: 0,
  border: { type: "line" },
  scrollable: true,
  alwaysScroll: true,
  mouse: true,
  keys: true,
  vi: true,
  tags: true,
  scrollbar: { ch: " ", inverse: true, style: { bg: "blue" } },
  content: "",
  style: { border: { fg: "bright-cyan" }, bg: "default" }
});

const walletBox = blessed.box({
  label: " Informasi Wallet ",
  border: { type: "line" },
  tags: true,
  style: { border: { fg: "magenta" }, fg: "white", bg: "default", align: "left", valign: "top" },
  content: "Loading Data wallet..."
});

const mainMenu = blessed.list({
  label: " Menu ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "green", fg: "black" } },
  items: getMainMenuItems()
});

const priorSubMenu = blessed.list({
  label: " Prior Swap Sub Menu ",
  left: "60%",
  keys: true,
  vi: true,
  mouse: true,
  border: { type: "line" },
  style: { fg: "white", bg: "default", border: { fg: "red" }, selected: { bg: "cyan", fg: "black" } },
  items: getPriorMenuItems()
});
priorSubMenu.hide();

const promptBox = blessed.prompt({
  parent: screen,
  border: "line",
  height: 5,
  width: "60%",
  top: "center",
  left: "center",
  label: "{bright-blue-fg}Swap Prompt{/bright-blue-fg}",
  tags: true,
  keys: true,
  vi: true,
  mouse: true,
  style: { fg: "bright-red", bg: "default", border: { fg: "red" } }
});

screen.append(headerBox);
screen.append(descriptionBox);
screen.append(logsBox);
screen.append(walletBox);
screen.append(mainMenu);
screen.append(priorSubMenu);

// 菜单项生成函数
function getMainMenuItems() {
  let items = ["Prior Swap", "Clam Faucet", "Auto Mode (All Accounts)", "Clear Transaction Logs", "Refresh", "Exit"];
  if (priorSwapRunning) {
    items.unshift("Stop All Transactions");
  }
  if (autoModeRunning) {
    items.unshift("Stop Auto Mode");
  }
  return items;
}

function getPriorMenuItems() {
  let items = ["Auto Swap Prior & USDC/USDT", "Clear Transaction Logs", "Back To Main Menu", "Refresh"];
  if (priorSwapRunning) {
    items.splice(1, 0, "Stop Transaction");
  }
  return items;
}

// 更新钱包信息显示
function updateWallet() {
  let content = "";
  
  walletsInfo.forEach((walletInfo, index) => {
    const shortAddress = walletInfo.address ? getShortAddress(walletInfo.address) : "N/A";
    const prior = walletInfo.balancePrior ? Number(walletInfo.balancePrior).toFixed(2) : "0.00";
    const usdc = walletInfo.balanceUSDC ? Number(walletInfo.balanceUSDC).toFixed(2) : "0.00";
    const usdt = walletInfo.balanceUSDT ? Number(walletInfo.balanceUSDT).toFixed(2) : "0.00";
    const eth = walletInfo.balanceETH ? Number(walletInfo.balanceETH).toFixed(4) : "0.000";
    
    content += `┌── Account ${index + 1}: {bright-yellow-fg}${shortAddress}{/bright-yellow-fg}
│   ├── ETH     : {bright-green-fg}${eth}{/bright-green-fg}
│   ├── PRIOR   : {bright-green-fg}${prior}{/bright-green-fg}
│   ├── USDC    : {bright-green-fg}${usdc}{/bright-green-fg}
│   └── USDT    : {bright-green-fg}${usdt}{/bright-green-fg}
`;
  });
  
  content += `└── Network     : {bright-cyan-fg}${NETWORK_NAME}{/bright-cyan-fg}\n`;

  walletBox.setContent(content);
  safeRender();
}

// 更新所有钱包数据
async function updateWalletData() {
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    
    // 清空或初始化钱包信息数组
    walletsInfo = [];
    
    // 为每个私钥创建钱包并获取余额
    for (const privateKey of PRIVATE_KEYS) {
      const wallet = new ethers.Wallet(privateKey, provider);
      const walletInfo = {
        address: wallet.address,
        balanceETH: "0.00",
        balancePrior: "0.00",
        balanceUSDC: "0.00",
        balanceUSDT: "0.00",
        network: NETWORK_NAME,
        status: "Initializing"
      };
      
      try {
        const [ethBalance, balancePrior, balanceUSDC, balanceUSDT] = await Promise.all([
          provider.getBalance(wallet.address),
          new ethers.Contract(PRIOR_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address),
          new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address),
          new ethers.Contract(USDT_ADDRESS, ERC20_ABI, provider).balanceOf(wallet.address)
        ]);

        walletInfo.balanceETH = ethers.formatEther(ethBalance);
        walletInfo.balancePrior = ethers.formatEther(balancePrior);
        walletInfo.balanceUSDC = ethers.formatUnits(balanceUSDC, 6);
        walletInfo.balanceUSDT = ethers.formatUnits(balanceUSDT, 6);
        walletInfo.status = "Ready";
      } catch (error) {
        walletInfo.status = "Error: " + error.message;
      }
      
      walletsInfo.push(walletInfo);
    }
    
    updateWallet();
    addLog("All wallet balances updated!", "system");
  } catch (error) {
    addLog("Failed to update wallet data: " + error.message, "error");
  }
}

// 停止所有交易
function stopAllTransactions() {
  if (priorSwapRunning) {
    priorSwapCancelled = true;
    addLog("Stop All Transactions command received. Semua transaksi telah dihentikan.", "system");
  }
  if (autoModeRunning) {
    autoModeCancelled = true;
    addLog("Auto mode stopped.", "system");
  }
}

// 自动领取 faucet
async function autoClaimFaucet(wallet) {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const faucetContract = new ethers.Contract(FAUCET_ADDRESS, FAUCET_ABI, wallet);

  try {
    const lastClaim = await faucetContract.lastClaimTime(wallet.address);
    const cooldown = await faucetContract.claimCooldown();
    const currentTime = Math.floor(Date.now() / 1000);
    const nextClaimTime = Number(lastClaim) + Number(cooldown);

    if (currentTime < nextClaimTime) {
      const waitTime = nextClaimTime - currentTime;
      const waitHours = Math.floor(waitTime / 3600); 
      const waitMinutes = Math.floor((waitTime % 3600) / 60);
      addLog(`[${getShortAddress(wallet.address)}] You have to wait ${waitHours} Hours ${waitMinutes} minutes before claiming again.`, "warning");
      return false;
    }
    
    addLog(`[${getShortAddress(wallet.address)}] Starting Claim Faucet PRIOR...`, "system");
    const tx = await faucetContract.claimTokens();
    const txHash = tx.hash;
    addLog(`[${getShortAddress(wallet.address)}] Transaction Sent!!. Hash: ${getShortHash(txHash)}`, "warning");

    const receipt = await tx.wait();
    if (receipt.status === 1) {
      addLog(`[${getShortAddress(wallet.address)}] Claim Faucet Successfully!!`, "success");
      await updateWalletData();
      return true;
    } else {
      addLog(`[${getShortAddress(wallet.address)}] Claim Faucet Failed.`, "error");
      return false;
    }
  } catch (error) {
    addLog(`[${getShortAddress(wallet.address)}] Error When Claiming: ${error.message}`, "error");
    return false;
  }
}

// 自动运行 swap
async function runAutoSwap(wallet, loopCount = 10) {
  if (priorSwapRunning) {
    addLog(`[${getShortAddress(wallet.address)}] Prior: Transaksi Sedang Berjalan. Silahkan stop transaksi terlebih dahulu.`, "prior");
    return;
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const priorToken = new ethers.Contract(PRIOR_ADDRESS, ERC20_ABI, wallet);
  const usdcToken = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);

  priorSwapRunning = true;
  priorSwapCancelled = false;
  mainMenu.setItems(getMainMenuItems());
  priorSubMenu.setItems(getPriorMenuItems());
  safeRender();

  for (let i = 1; i <= loopCount; i++) {
    if (priorSwapCancelled) {
      addLog(`[${getShortAddress(wallet.address)}] Prior Swap: Auto swap dihentikan pada Cycle Ke ${i}.`, "prior");
      break;
    }

    const randomAmount = getRandomNumber(0.001, 0.01);
    const amountPrior = ethers.parseEther(randomAmount.toFixed(6));
    const isUSDC = i % 2 === 1;
    const functionSelector = isUSDC ? "0xf3b68002" : "0x03b530a3";
    const swapTarget = isUSDC ? "USDC" : "USDT";
    
    try {
      // 批准交易
      const approveTx = await priorToken.approve(routerAddress, amountPrior);
      const txHash = approveTx.hash;
      addLog(`[${getShortAddress(wallet.address)}] Prior: Approval Transaction dikirim. Hash: ${getShortHash(txHash)}`, "prior");
      const approveReceipt = await approveTx.wait();
      
      if (approveReceipt.status !== 1) {
        addLog(`[${getShortAddress(wallet.address)}] Prior: Approval gagal. Melewati Cycle ini.`, "prior");
        await delay(getRandomNumber(30000, 60000));
        continue;
      }
      
      addLog(`[${getShortAddress(wallet.address)}] Prior: Approval berhasil.`, "prior");
    } catch (approvalError) {
      addLog(`[${getShortAddress(wallet.address)}] Prior: Error saat approval: ${approvalError.message}`, "prior");
      await delay(getRandomNumber(30000, 60000));
      continue;
    }

    // 执行swap交易
    const paramHex = ethers.zeroPadValue(ethers.toBeHex(amountPrior), 32);
    const txData = functionSelector + paramHex.slice(2);
    
    try {
      addLog(`[${getShortAddress(wallet.address)}] Prior: Melakukan swap PRIOR ➯ ${swapTarget}, Ammount ${ethers.formatEther(amountPrior)} PRIOR`, "prior");
      const tx = await wallet.sendTransaction({
        to: routerAddress,
        data: txData,
        gasLimit: 500000
      });
      
      const txHash = tx.hash;
      addLog(`[${getShortAddress(wallet.address)}] Prior: Transaksi dikirim. Hash: ${getShortHash(txHash)}`, "prior");
      const receipt = await tx.wait();
      
      if (receipt.status === 1) {
        addLog(`[${getShortAddress(wallet.address)}] Prior: Swap PRIOR ➯ ${swapTarget} berhasil.`, "prior");
        await updateWalletData();
        addLog(`[${getShortAddress(wallet.address)}] Prior: Swap Ke ${i} Selesai.`, "prior");
      } else {
        addLog(`[${getShortAddress(wallet.address)}] Prior: Swap PRIOR ➯ ${swapTarget} gagal.`, "prior");
      }
    } catch (txError) {
      addLog(`[${getShortAddress(wallet.address)}] Prior Swap: Error saat mengirim transaksi swap: ${txError.message}`, "prior");
    }

    // 如果不是最后一次循环，等待随机时间
    if (i < loopCount) {
      const delayTime = getRandomDelay();
      const minutes = Math.floor(delayTime / 60000);
      const seconds = Math.floor((delayTime % 60000) / 1000);
      addLog(`[${getShortAddress(wallet.address)}] Prior: Menunggu ${minutes} menit ${seconds} detik sebelum transaksi berikutnya`, "prior");
      await waitWithCancel(delayTime, "prior");
      
      if (priorSwapCancelled) {
        addLog(`[${getShortAddress(wallet.address)}] Prior: Auto swap Dihentikan saat waktu tunggu.`, "prior");
        break;
      }
    }
  }
  
  priorSwapRunning = false;
  mainMenu.setItems(getMainMenuItems());
  priorSubMenu.setItems(getPriorMenuItems());
  safeRender();
  addLog(`[${getShortAddress(wallet.address)}] Prior Swap: Auto swap selesai.`, "prior");
}

// 自动模式 - 所有账号自动运行
async function runAutoMode() {
  if (autoModeRunning) {
    addLog("Auto mode is already running.", "warning");
    return;
  }

  autoModeRunning = true;
  autoModeCancelled = false;
  mainMenu.setItems(getMainMenuItems());
  safeRender();

  try {
    while (!autoModeCancelled) {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      
      // 为每个账号执行操作
      for (const privateKey of PRIVATE_KEYS) {
        if (autoModeCancelled) break;
        
        const wallet = new ethers.Wallet(privateKey, provider);
        
        // 1. 先领取faucet
        addLog(`[${getShortAddress(wallet.address)}] Starting faucet claim...`, "system");
        await autoClaimFaucet(wallet);
        
        // 2. 运行swap 10次
        addLog(`[${getShortAddress(wallet.address)}] Starting auto swap (10 times)...`, "system");
        await runAutoSwap(wallet, 10);
        
        // 更新钱包数据
        await updateWalletData();
        
        // 如果不是最后一个账号，等待随机时间
        if (privateKey !== PRIVATE_KEYS[PRIVATE_KEYS.length - 1] && !autoModeCancelled) {
          const delayTime = getRandomDelay();
          const minutes = Math.floor(delayTime / 60000);
          const seconds = Math.floor((delayTime % 60000) / 1000);
          addLog(`[${getShortAddress(wallet.address)}] Waiting ${minutes}m ${seconds}s before next account...`, "system");
          await waitWithCancel(delayTime, "auto");
        }
      }
      
      // 如果不是被取消，等待12小时后再次运行
      if (!autoModeCancelled) {
        addLog("All accounts completed. Waiting 12 hours before next cycle...", "system");
        
        // 12小时 = 12 * 60 * 60 * 1000 = 43200000毫秒
        const twelveHours = 43200000;
        const hours = Math.floor(twelveHours / 3600000);
        const minutes = Math.floor((twelveHours % 3600000) / 60000);
        
        addLog(`Next cycle will start in ${hours} hours ${minutes} minutes...`, "system");
        await waitWithCancel(twelveHours, "auto");
      }
    }
  } catch (error) {
    addLog(`Auto mode error: ${error.message}`, "error");
  } finally {
    autoModeRunning = false;
    mainMenu.setItems(getMainMenuItems());
    safeRender();
    addLog("Auto mode stopped.", "system");
  }
}

// UI布局调整
function adjustLayout() {
  const screenHeight = screen.height;
  const screenWidth = screen.width;
  const headerHeight = Math.max(8, Math.floor(screenHeight * 0.15));
  
  headerBox.top = 0;
  headerBox.height = headerHeight;
  headerBox.width = "100%";
  
  descriptionBox.top = "25%";
  descriptionBox.height = Math.floor(screenHeight * 0.05);
  
  logsBox.top = headerHeight + descriptionBox.height;
  logsBox.left = 0;
  logsBox.width = Math.floor(screenWidth * 0.6);
  logsBox.height = screenHeight - (headerHeight + descriptionBox.height);
  
  walletBox.top = headerHeight + descriptionBox.height;
  walletBox.left = Math.floor(screenWidth * 0.6);
  walletBox.width = Math.floor(screenWidth * 0.4);
  walletBox.height = Math.floor(screenHeight * 0.35);
  
  mainMenu.top = headerHeight + descriptionBox.height + walletBox.height;
  mainMenu.left = Math.floor(screenWidth * 0.6);
  mainMenu.width = Math.floor(screenWidth * 0.4);
  mainMenu.height = screenHeight - (headerHeight + descriptionBox.height + walletBox.height);
  
  priorSubMenu.top = mainMenu.top;
  priorSubMenu.left = mainMenu.left;
  priorSubMenu.width = mainMenu.width;
  priorSubMenu.height = mainMenu.height;
  
  safeRender();
}

// 事件监听
screen.on("resize", adjustLayout);
adjustLayout();

mainMenu.on("select", (item) => {
  const selected = item.getText();
  
  if (selected === "Stop All Transactions" || selected === "Stop Auto Mode") {
    stopAllTransactions();
    mainMenu.setItems(getMainMenuItems());
    mainMenu.focus();
    safeRender();
  } else if (selected === "Prior Swap") {
    priorSubMenu.show();
    priorSubMenu.focus();
    safeRender();
  } else if (selected === "Clam Faucet") {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEYS[0], provider);
    autoClaimFaucet(wallet);
  } else if (selected === "Auto Mode (All Accounts)") {
    runAutoMode();
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Refresh") {
    updateWalletData();
    updateLogs();
    safeRender();
    addLog("Refreshed", "system");
  } else if (selected === "Exit") {
    process.exit(0);
  }
});

priorSubMenu.on("select", (item) => {
  const selected = item.getText();
  
  if (selected === "Auto Swap Prior & USDC/USDT") {
    promptBox.setFront();
    promptBox.readInput("Masukkan Jumalah Swap (default 10):", "10", async (err, value) => {
      promptBox.hide();
      safeRender();
      
      if (err) {
        addLog("Prior Swap: Input tidak valid atau dibatalkan.", "prior");
        return;
      }
      
      const loopCount = parseInt(value) || 10;
      addLog(`Prior Swap: Anda Memasukkan ${loopCount} kali auto swap.`, "prior");
      
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const wallet = new ethers.Wallet(PRIVATE_KEYS[0], provider);
      await runAutoSwap(wallet, loopCount);
    });
  } else if (selected === "Stop Transaction") {
    if (priorSwapRunning) {
      priorSwapCancelled = true;
      addLog("Prior Swap: Perintah Stop Transaction diterima.", "prior");
    } else {
      addLog("Prior Swap: Tidak ada transaksi yang berjalan.", "prior");
    }
  } else if (selected === "Clear Transaction Logs") {
    clearTransactionLogs();
  } else if (selected === "Back To Main Menu") {
    priorSubMenu.hide();
    mainMenu.show();
    mainMenu.focus();
    safeRender();
  } else if (selected === "Refresh") {
    updateWalletData();
    updateLogs();
    safeRender();
    addLog("Refreshed", "system");
  }
});

// 键盘快捷键
screen.key(["escape", "q", "C-c"], () => process.exit(0));
screen.key(["C-up"], () => { logsBox.scroll(-1); safeRender(); });
screen.key(["C-down"], () => { logsBox.scroll(1); safeRender(); });

// 初始化
safeRender();
mainMenu.focus();
updateLogs();
updateWalletData();