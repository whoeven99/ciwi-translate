export interface OptionType {
  key: string;
  name: string;
  Credits: number;
  price: {
    currentPrice: number;
    comparedPrice: number;
    currencyCode: string;
  };
}

type PackDefinition = {
  key: string;
  name: string;
  credits: number;
  fullPrice: number;
};

const PACK_DEFINITIONS: PackDefinition[] = [
  { key: "option-100k", name: "100K", credits: 100000, fullPrice: 1.99 },
  { key: "option-300k", name: "300K", credits: 300000, fullPrice: 2.99 },
  { key: "option-1", name: "500K", credits: 500000, fullPrice: 3.99 },
  { key: "option-2", name: "1M", credits: 1000000, fullPrice: 7.99 },
  { key: "option-3", name: "2M", credits: 2000000, fullPrice: 15.99 },
  { key: "option-4", name: "3M", credits: 3000000, fullPrice: 23.99 },
  { key: "option-5", name: "5M", credits: 5000000, fullPrice: 39.99 },
  { key: "option-6", name: "10M", credits: 10000000, fullPrice: 79.99 },
  { key: "option-7", name: "20M", credits: 20000000, fullPrice: 159.99 },
  { key: "option-8", name: "30M", credits: 30000000, fullPrice: 239.99 },
];

export function buildPaymentOptions(plan: any): OptionType[] {
  return PACK_DEFINITIONS.map((pack) => ({
    key: pack.key,
    name: pack.name,
    Credits: pack.credits,
    price: {
      currentPrice: getDiscountedPrice(pack.fullPrice, plan),
      comparedPrice: pack.fullPrice,
      currencyCode: "USD",
    },
  }));
}

function getDiscountedPrice(fullPrice: number, plan: any): number {
  if (plan?.isInFreePlanTime) {
    return fullPrice;
  }

  const discountRatio =
    plan?.type === "Premium"
      ? 0.5
      : plan?.type === "Pro"
        ? 0.75
        : plan?.type === "Basic"
          ? 0.9
          : 1;

  const fullPriceInCents = Math.round(fullPrice * 100);
  return Math.floor(fullPriceInCents * discountRatio) / 100;
}
