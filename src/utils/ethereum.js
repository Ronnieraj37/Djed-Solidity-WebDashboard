import Web3 from "web3";
import djedArtifact from "../artifacts/DjedProtocol.json";
import oracleArtifact from "../artifacts/AdaUsdSimpleOracle.json";
import { BN } from "web3-utils";

import djedStableCoinArtifact from "../artifacts/DjedStableCoin.json";
import djedReserveCoinArtifact from "../artifacts/DjedReserveCoin.json";
import {
  buildTx,
  convertInt,
  decimalScaling,
  decimalUnscaling,
  scaledPromise,
  scaledUnscaledPromise,
  web3Promise
} from "./helpers";

const BLOCKCHAIN_URI = "https://rpc-devnet-cardano-evm.c1.milkomeda.com/";
export const CHAIN_ID = 200101;
const DJED_ADDRESS = "0x52527fF4a1d99a35B75d821e90F23512D9327fdf"; // djedAddress
const ORACLE_ADDRESS = "0x5A8E0B0B666A60Cf4f00E56A7C6C73FcE77eAaD6"; // oracleAddress
const BC_DECIMALS = 18;
const SCALING_DECIMALS = 24; // scalingFixed
const REFRESH_PERIOD = 4000;

export const getWeb3 = () =>
  new Promise(async (resolve, reject) => {
    if (window.ethereum) {
      try {
        const web3 = new Web3(BLOCKCHAIN_URI);
        resolve(web3);
      } catch (error) {
        reject(error);
      }
    }
    reject("Install Metamask");
  });

export const getDjedContract = (web3) => {
  const djed = new web3.eth.Contract(djedArtifact.abi, DJED_ADDRESS);
  return djed;
};

export const getOracleContract = (web3) => {
  const oracle = new web3.eth.Contract(oracleArtifact.abi, ORACLE_ADDRESS);
  return oracle;
};

export const getCoinContracts = async (djedContract, web3) => {
  const [stableCoinAddress, reserveCoinAddress] = await Promise.all([
    web3Promise(djedContract, "stableCoin"),
    web3Promise(djedContract, "reserveCoin")
  ]);
  const stableCoin = new web3.eth.Contract(djedStableCoinArtifact.abi, stableCoinAddress);
  const reserveCoin = new web3.eth.Contract(
    djedReserveCoinArtifact.abi,
    reserveCoinAddress
  );
  return { stableCoin, reserveCoin };
};

export const getDecimals = async (stableCoin, reserveCoin) => {
  const [scDecimals, rcDecimals] = await Promise.all([
    convertInt(web3Promise(stableCoin, "decimals")),
    convertInt(web3Promise(reserveCoin, "decimals"))
  ]);
  return { scDecimals, rcDecimals };
};

export const getCoinDetails = async (
  stableCoin,
  reserveCoin,
  djed,
  scDecimals,
  rcDecimals
) => {
  const [
    [scaledNumberSc, unscaledNumberSc],
    scaledPriceSc,
    scaledNumberRc,
    scaledReserveBc,
    percentReserveRatio,
    scaledBuyPriceRc,
    scaledSellPriceRc
  ] = await Promise.all([
    scaledUnscaledPromise(web3Promise(stableCoin, "totalSupply"), scDecimals),
    scaledPromise(web3Promise(djed, "getStableCoinWholeTargetPriceBC"), BC_DECIMALS), //oracle, "exchangeRate"), BC_DECIMALS),
    scaledPromise(web3Promise(reserveCoin, "totalSupply"), rcDecimals),
    scaledPromise(web3Promise(djed, "reserveBC"), BC_DECIMALS),
    scaledPromise(web3Promise(djed, "getReserveRatio"), SCALING_DECIMALS).then(
      (value) => (parseFloat(value) * 100).toFixed(4) + "%"
    ),
    scaledPromise(web3Promise(djed, "getReserveCoinWholeBuyPriceBC"), BC_DECIMALS),
    scaledPromise(web3Promise(djed, "getReserveCoinWholeSellPriceBC"), BC_DECIMALS)
  ]);

  return {
    scaledNumberSc,
    unscaledNumberSc,
    scaledPriceSc,
    scaledNumberRc,
    scaledReserveBc,
    percentReserveRatio,
    scaledBuyPriceRc,
    scaledSellPriceRc
  };
};

export const getSystemParams = async (djed) => {
  const [reserveRatioMin, reserveRatioMax, fee, thresholdNumberSc] = await Promise.all([
    scaledPromise(web3Promise(djed, "reserveRatioMin"), SCALING_DECIMALS),
    scaledPromise(web3Promise(djed, "reserveRatioMax"), SCALING_DECIMALS),
    scaledPromise(web3Promise(djed, "fee"), SCALING_DECIMALS),
    web3Promise(djed, "thresholdNumberSC")
  ]);

  return {
    reserveRatioMin,
    reserveRatioMax,
    fee,
    thresholdNumberSc
  };
};

export const getAccountDetails = async (
  web3,
  account,
  stableCoin,
  reserveCoin,
  scDecimals,
  rcDecimals
) => {
  const [
    [scaledBalanceSc, unscaledBalanceSc],
    [scaledBalanceRc, unscaledBalanceRc],
    scaledBalanceBc
  ] = await Promise.all([
    scaledUnscaledPromise(web3Promise(stableCoin, "balanceOf", account), scDecimals),
    scaledUnscaledPromise(web3Promise(reserveCoin, "balanceOf", account), rcDecimals),
    scaledPromise(web3.eth.getBalance(account), BC_DECIMALS)
  ]);

  return {
    scaledBalanceSc,
    unscaledBalanceSc,
    scaledBalanceRc,
    unscaledBalanceRc,
    scaledBalanceBc
  };
};

export const promiseTx = (accounts, tx) => {
  if (accounts.length === 0) {
    return Promise.reject(new Error("Metamask not connected!"));
  }
  return window.ethereum.request({
    method: "eth_sendTransaction",
    params: [tx]
  });
};

export const verifyTx = (web3, hash) => {
  return new Promise((res) => {
    setTimeout(() => {
      web3.eth.getTransactionReceipt(hash).then((receipt) => res(receipt.status));
    }, REFRESH_PERIOD);
  });
};

const tradeDataPriceCore = (djed, method, decimals, amountScaled) => {
  const amountUnscaled = decimalUnscaling(amountScaled, decimals);
  return web3Promise(djed, method, amountUnscaled.toString(10)).then((totalUnscaled) => ({
    amountScaled,
    amountUnscaled,
    totalScaled: decimalScaling(totalUnscaled, BC_DECIMALS),
    totalUnscaled
  }));
};

// reservecoin
export const tradeDataPriceBuyRc = (djed, rcDecimals, amountScaled) =>
  tradeDataPriceCore(djed, "getPriceBuyNReserveCoinsBC", rcDecimals, amountScaled);

export const tradeDataPriceSellRc = (djed, rcDecimals, amountScaled) =>
  tradeDataPriceCore(djed, "getPriceSellNReserveCoinsBC", rcDecimals, amountScaled);

export const buyRcTx = (djed, account, value) => {
  const data = djed.methods.buyReserveCoins().encodeABI();
  return buildTx(account, DJED_ADDRESS, value, data);
};

export const sellRcTx = (djed, account, amount) => {
  const data = djed.methods.sellReserveCoins(amount).encodeABI();
  return buildTx(account, DJED_ADDRESS, 0, data);
};

export const checkBuyableRc = (djed, unscaledAmountRc) =>
  web3Promise(djed, "checkBuyableNReserveCoins", unscaledAmountRc);

export const checkSellableRc = (djed, unscaledAmountRc, unscaledBalanceRc) => {
  if (new BN(unscaledAmountRc).gt(new BN(unscaledBalanceRc))) {
    return new Promise((r) => false);
  }
  return web3Promise(djed, "checkSellableNReserveCoins", unscaledAmountRc);
};

export const getMaxBuyRc = (djed, rcDecimals, unscaledNumberSc, thresholdNumberSc) => {
  if (new BN(unscaledNumberSc).lt(new BN(thresholdNumberSc))) {
    // empty string returned on no limit:
    return new Promise((r) => r(""));
  }
  return scaledPromise(web3Promise(djed, "getMaxBuyableReserveCoins"), rcDecimals);
};

export const getMaxSellRc = (djed, rcDecimals, unscaledBalanceRc) => {
  return scaledUnscaledPromise(
    web3Promise(djed, "getMaxSellableReserveCoins"),
    rcDecimals
  ).then(([scaledMax, unscaledMax]) =>
    new BN(unscaledBalanceRc).gt(new BN(unscaledMax))
      ? scaledMax
      : decimalScaling(unscaledBalanceRc.toString(10), rcDecimals)
  );
};

// stablecoin
export const tradeDataPriceBuySc = (djed, scDecimals, amountScaled) =>
  tradeDataPriceCore(djed, "getPriceBuyNStableCoinsBC", scDecimals, amountScaled);

export const tradeDataPriceSellSc = (djed, scDecimals, amountScaled) =>
  tradeDataPriceCore(djed, "getPriceSellNStableCoinsBC", scDecimals, amountScaled);

export const buyScTx = (djed, account, value) => {
  const data = djed.methods.buyStableCoins().encodeABI();
  return buildTx(account, DJED_ADDRESS, value, data);
};

export const sellScTx = (djed, account, amount) => {
  const data = djed.methods.sellStableCoins(amount).encodeABI();
  return buildTx(account, DJED_ADDRESS, 0, data);
};

export const checkBuyableSc = (djed, unscaledAmountSc) =>
  web3Promise(djed, "checkBuyableNStableCoins", unscaledAmountSc);

export const checkSellableSc = (unscaledAmountSc, unscaledBalanceSc) =>
  new Promise((r) => r(!new BN(unscaledAmountSc).gt(new BN(unscaledBalanceSc))));

export const getMaxBuySc = (djed, scDecimals) => {
  return scaledPromise(web3Promise(djed, "getMaxBuyableStableCoins"), scDecimals);
};

// maxSellSc is just the current account balance, no additional protocol limits:
export const getMaxSellSc = (scaledBalanceSc) => new Promise((r) => r(scaledBalanceSc));
