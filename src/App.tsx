import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { Cpu, Wallet, Coins, ExternalLink, Send, ShieldCheck, AlertCircle, ArrowLeftRight } from 'lucide-react';

declare global {
  interface Window {
    ethereum?: any;
  }
}

// ВАШ BUILDER CODE
const BUILDER_HEX = "0x62635f68786469716a6b310b0080218021802180218021802180218021"; 

// АДРЕСА
const MAINNET_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const SEPOLIA_GTK = "0x68505A3FbA339C888c99533d5fAd09E17ed959D5"; 
const UNISWAP_ROUTER = "0x2626664c2602336719497100047a550cc2f823f0";
const WETH_MAINNET = "0x4200000000000000000000000000000000000006";

const BASE_SEPOLIA_RPC = "https://base-sepolia.gateway.tenderly.co";
const BASE_MAINNET_RPC = "https://mainnet.base.org";

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)"
];

export default function App() {
  const [mode, setMode] = useState<'MAINNET' | 'TESTNET'>('MAINNET');
  const [account, setAccount] = useState<string | null>(null);
  const [ethBalance, setEthBalance] = useState<string>("0");
  const [usdcBalance, setUsdcBalance] = useState<string>("0");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [sendAddress, setSendAddress] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sendType, setSendType] = useState<'ETH' | 'TOKEN'>('ETH');

  const [swapDirection, setSwapDirection] = useState<'ETH_TO_USDC' | 'USDC_TO_ETH'>('ETH_TO_USDC');
  const [swapAmount, setSwapAmount] = useState("");

  const updateBalance = useCallback(async (userAddress: string) => {
    if (!userAddress) return;
    try {
      const rpcUrl = mode === 'MAINNET' ? BASE_MAINNET_RPC : BASE_SEPOLIA_RPC;
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const ethBal = await provider.getBalance(userAddress);
      setEthBalance(ethers.formatEther(ethBal));

      if (mode === 'MAINNET') {
        const usdcContract = new ethers.Contract(MAINNET_USDC, ERC20_ABI, provider);
        const usdcBal = await usdcContract.balanceOf(userAddress);
        setUsdcBalance(ethers.formatUnits(usdcBal, 6)); 
      } else {
        const contract = new ethers.Contract(SEPOLIA_GTK, ERC20_ABI, provider);
        const bal = await contract.balanceOf(userAddress);
        setUsdcBalance(ethers.formatEther(bal));
      }
    } catch (err) { console.error(err); }
  }, [mode]);

  useEffect(() => {
    if (account) updateBalance(account);
    if (window.ethereum) {
      window.ethereum.request({ method: 'eth_accounts' }).then((accounts: any) => {
        if (accounts?.length > 0) setAccount(accounts[0]);
      });
      window.ethereum.on('accountsChanged', (accounts: any) => setAccount(accounts[0] || null));
    }
  }, [account, mode, updateBalance]);

  const executeTx = async (txFn: (signer: ethers.Signer) => Promise<any>) => {
    setLoading(true);
    setError(null);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const tx = await txFn(signer);
      await tx.wait();
      alert("Транзакция успешно выполнена!");
      updateBalance(account!);
    } catch (err: any) {
      setError(err.reason || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = () => {
    if (!sendAddress || !sendAmount) return alert("Заполните поля");
    executeTx(async (signer) => {
      const tag = BUILDER_HEX.replace('0x', '');
      
      if (sendType === 'ETH') {
        // ДЛЯ ETH ПЕРЕВОДОВ: Убираем DATA, чтобы не было ошибки "cannot include data"
        return await signer.sendTransaction({
          to: sendAddress,
          value: ethers.parseEther(sendAmount)
        });
      } else {
        // ДЛЯ ТОКЕНОВ (USDC): Здесь тег работает и НУЖЕН для атрибуции
        const tokenAddr = mode === 'MAINNET' ? MAINNET_USDC : SEPOLIA_GTK;
        const decimals = mode === 'MAINNET' ? 6 : 18;
        const contract = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
        const amount = ethers.parseUnits(sendAmount, decimals);
        const txData = await contract.transfer.populateTransaction(sendAddress, amount);
        return await signer.sendTransaction({
          ...txData,
          data: txData.data + tag
        });
      }
    });
  };

  const handleSwap = () => {
    if (!swapAmount) return alert("Введите сумму");
    executeTx(async (signer) => {
      const router = new ethers.Contract(UNISWAP_ROUTER, ROUTER_ABI, signer);
      const tag = BUILDER_HEX.replace('0x', '');
      if (swapDirection === 'ETH_TO_USDC') {
        const amountIn = ethers.parseEther(swapAmount);
        const params = {
          tokenIn: WETH_MAINNET,
          tokenOut: MAINNET_USDC,
          fee: 500,
          recipient: account,
          amountIn,
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0
        };
        const txData = await router.exactInputSingle.populateTransaction(params);
        return await signer.sendTransaction({
          ...txData,
          data: txData.data + tag,
          value: amountIn
        });
      } else {
        const amountIn = ethers.parseUnits(swapAmount, 6);
        const usdc = new ethers.Contract(MAINNET_USDC, ERC20_ABI, signer);
        if (await usdc.allowance(account, UNISWAP_ROUTER) < amountIn) {
          const appTx = await usdc.approve(UNISWAP_ROUTER, ethers.MaxUint256);
          await appTx.wait();
        }
        const params = {
          tokenIn: MAINNET_USDC,
          tokenOut: WETH_MAINNET,
          fee: 500,
          recipient: account,
          amountIn,
          amountOutMinimum: 0,
          sqrtPriceLimitX96: 0
        };
        const txData = await router.exactInputSingle.populateTransaction(params);
        return await signer.sendTransaction({ ...txData, data: txData.data + tag });
      }
    });
  };

  return (
    <div className="min-h-screen bg-[#08090A] text-[#E0E0E0] p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto">
        <header className="flex flex-col md:flex-row justify-between items-center mb-12 gap-6">
          <h1 className="text-5xl font-black italic uppercase tracking-tighter">GAME<span className="text-orange-500 not-italic">TOKEN</span></h1>
          <button onClick={async () => { const acc = await window.ethereum.request({ method: 'eth_requestAccounts' }); setAccount(acc[0]); }} className="px-8 py-4 bg-white text-black rounded-2xl font-black tracking-widest uppercase hover:bg-orange-500 hover:text-white transition-all shadow-xl">
             <Wallet className="inline-block mr-2 w-5 h-5" /> {account ? `${account.substring(0,6)}...${account.substring(38)}` : "Connect Wallet"}
          </button>
        </header>

        <div className="flex justify-center mb-10">
          <div className="bg-white/5 p-1 rounded-xl border border-white/10 flex gap-1">
            <button onClick={() => setMode('MAINNET')} className={`px-6 py-2 rounded-lg text-[10px] font-bold uppercase transition-all ${mode === 'MAINNET' ? 'bg-orange-500 text-white' : 'opacity-40'}`}>Mainnet</button>
            <button onClick={() => setMode('TESTNET')} className={`px-6 py-2 rounded-lg text-[10px] font-bold uppercase transition-all ${mode === 'TESTNET' ? 'bg-blue-600 text-white' : 'opacity-40'}`}>Sepolia</button>
          </div>
        </div>

        {error && <div className="mb-8 p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-500 text-[10px] font-mono break-all line-clamp-3">{error}</div>}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 space-y-6">
            <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/10 backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-widest opacity-40 mb-2 font-bold">Base ETH</p>
              <div className="text-5xl font-black">{parseFloat(ethBalance).toFixed(4)}</div>
            </div>
            <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/10 backdrop-blur-xl">
              <p className="text-[10px] uppercase tracking-widest opacity-40 mb-2 font-bold">{mode === 'MAINNET' ? 'USDC' : 'GTK Token'}</p>
              <div className="text-5xl font-black">{parseFloat(usdcBalance).toFixed(2)}</div>
            </div>
          </div>

          <div className="lg:col-span-8 space-y-8">
            <div className="p-10 bg-white/5 rounded-[3rem] border border-white/10">
               <div className="flex justify-between items-center mb-10">
                 <h3 className="text-2xl font-black uppercase tracking-tighter">Fast Send</h3>
                 <div className="flex gap-2 p-1 bg-black/40 rounded-xl border border-white/10">
                   <button onClick={() => setSendType('ETH')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${sendType === 'ETH' ? 'bg-blue-500 text-white' : 'opacity-30'}`}>ETH</button>
                   <button onClick={() => setSendType('TOKEN')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${sendType === 'TOKEN' ? 'bg-green-500 text-white' : 'opacity-30'}`}>{mode === 'MAINNET' ? 'USDC' : 'GTK'}</button>
                 </div>
               </div>
               <div className="grid md:grid-cols-2 gap-4 mb-6">
                 <input value={sendAddress} onChange={e=>setSendAddress(e.target.value)} placeholder="Recipient 0x..." className="bg-black/40 border border-white/10 p-5 rounded-2xl text-sm font-mono focus:border-blue-500 outline-none transition-all" />
                 <input type="number" value={sendAmount} onChange={e=>setSendAmount(e.target.value)} placeholder="0.0" className="bg-black/40 border border-white/10 p-5 rounded-2xl text-3xl font-black focus:border-blue-500 outline-none transition-all" />
               </div>
               <button onClick={handleSend} disabled={loading} className="w-full py-6 bg-blue-600 hover:bg-blue-700 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] transition-all disabled:opacity-20 shadow-2xl">Execute Transfer</button>
            </div>

            {mode === 'MAINNET' && (
              <div className="p-10 bg-orange-500/5 rounded-[3rem] border border-orange-500/10">
                <h3 className="text-xl font-black uppercase tracking-widest text-orange-500 mb-8 flex items-center gap-3"><ArrowLeftRight className="w-5 h-5"/> Quick Swap</h3>
                <div className="bg-black/40 p-8 rounded-3xl border border-white/10 mb-6 focus-within:border-orange-500 transition-all">
                  <div className="flex items-center gap-4">
                    <input type="number" value={swapAmount} onChange={e=>setSwapAmount(e.target.value)} placeholder="0.0" className="flex-1 bg-transparent border-none text-4xl font-black text-white focus:outline-none" />
                    <button onClick={()=>setSwapDirection(d=>d==='ETH_TO_USDC'?'USDC_TO_ETH':'ETH_TO_USDC')} className="p-4 bg-orange-500 rounded-2xl hover:scale-110 transition-transform"><ArrowLeftRight className="w-5 h-5 text-white" /></button>
                  </div>
                  <p className="text-[10px] font-mono opacity-40 mt-4 uppercase tracking-widest">{swapDirection === 'ETH_TO_USDC' ? 'ETH → USDC' : 'USDC → ETH'}</p>
                </div>
                <button onClick={handleSwap} disabled={loading} className="w-full py-6 bg-orange-500 hover:bg-orange-600 text-white rounded-[2rem] font-black uppercase tracking-[0.2em] transition-all shadow-xl">Swap with Builder Code</button>
              </div>
            )}
          </div>
        </div>

        <footer className="mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 text-[8px] font-mono uppercase tracking-widest opacity-20">
           <div className="flex items-center gap-2"><ShieldCheck className="w-3 h-3" /> Attribution Protocol: Active</div>
           <div>Builder ID: 62635F... Indexing: Verified</div>
        </footer>
      </div>
    </div>
  );
}