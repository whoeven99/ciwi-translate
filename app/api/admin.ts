import axios from "axios";
import { LanguagesDataType } from "~/routes/app.language/route";
import { buildShopifyAdminGraphqlUrl } from "~/lib/shopifyAdminApiVersion";

export const queryMarketDomainData = async ({
  shop,
  accessToken,
}: {
  shop: string;
  accessToken: string;
}) => {
  try {
    const query = `{
      markets(first: 20) {
        nodes {
          id
          name
          handle
          conditions {
            regionsCondition {
              regions(first: 250) {
                nodes {
                  ... on MarketRegionCountry {
                    id
                    name
                    code
                  }
                }
              }
            }
          }
          currencySettings {
            baseCurrency {
              currencyCode
            }
          }
        }
      }
      shop {
        currencyCode
      }
    }`;

    const response = await axios({
      url: buildShopifyAdminGraphqlUrl(shop),
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken, // 确保使用正确的 Token 名称
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ query }),
    });

    const res = response?.data?.data;

    console.log(`${shop} queryMarketDomainData: `, res);

    return res;
  } catch (error) {
    console.error("Error queryMarketDomainData:", error);
    return null;
  }
};

export const queryAppByHandle = async ({
  shop,
  accessToken,
}: {
  shop: string;
  accessToken: string;
}) => {
  try {
    const query = `{
        pagefly: appByHandle(handle: "pagefly") {
          title
        }
    }`;

    const response = await axios({
      url: buildShopifyAdminGraphqlUrl(shop),
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken, // 确保使用正确的 Token 名称
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ query }),
    });
    const res = response?.data?.data;

    console.log(`${shop} queryAppByHandle: `, res);

    return res;
  } catch (error) {
    console.error("Error queryAppByHandle:", error);
    return null;
  }
};

export const queryShopLanguages = async ({
  shop,
  accessToken,
}: {
  shop: string;
  accessToken: string;
}) => {
  try {
    const query = `{
        shopLocales {
            name
            locale
            primary
            published
        }
    }`;

    const response = await axios({
      url: buildShopifyAdminGraphqlUrl(shop),
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken, // 确保使用正确的 Token 名称
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ query }),
    });
    const res = response?.data?.data?.shopLocales;

    return res;
  } catch (error) {
    console.error("Error queryShopLanguages:", error);
    return [];
  }
};

export const queryShopBaseConfigData = async ({
  shop,
  accessToken,
}: {
  shop: string;
  accessToken: string;
}) => {
  try {
    const query = `{
      shop {
        name
        shopOwnerName
        email
        currencyCode
        myshopifyDomain
        currencyFormats {
          moneyFormat
          moneyWithCurrencyFormat
        }
      }
    }`;

    const response = await axios({
      url: buildShopifyAdminGraphqlUrl(shop),
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ query }),
    });
    if (response.data?.errors?.length) {
      console.error(
        `${shop} queryShopBaseConfigData GraphQL errors:`,
        response.data.errors,
      );
      return null;
    }
    const res = response.data?.data;
    if (!res?.shop) {
      console.error(`${shop} queryShopBaseConfigData: missing shop in response`);
      return null;
    }
    console.log(`${shop} shopData: `, res?.shop);
    return res;
  } catch (error) {
    console.error(`${shop} Error queryShopBaseConfigData: `, error);
    return null;
  }
};

export const queryNextTransType = async ({
  shop,
  accessToken,
  resourceType,
  endCursor,
  locale,
}: {
  shop: string;
  accessToken: string;
  resourceType: string;
  endCursor: string;
  locale: string;
}) => {
  try {
    const query = `{
      translatableResources(resourceType: ${resourceType}, first: 20 ${endCursor ? `, after: "${endCursor}"` : ""}, reverse: true) {
        nodes {
          resourceId
          translatableContent {
            key
            digest
            locale
            type
            value
          }
          translations(locale: "${locale}") {
            key
            value
            outdated
          }
        }
        pageInfo {
          endCursor
          hasNextPage
          hasPreviousPage
          startCursor
        }
      }
    }`;

    const response = await axios({
      url: buildShopifyAdminGraphqlUrl(shop),
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken, // 确保使用正确的 Token 名称
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ query }),
    });
    const res = response.data.data.translatableResources;
    return res;
  } catch (error) {
    console.error(`Error fetching ${resourceType} queryNextTransType:`, error);
  }
};

export const queryPreviousTransType = async ({
  shop,
  accessToken,
  resourceType,
  startCursor,
  locale,
}: {
  shop: string;
  accessToken: string;
  resourceType: string;
  startCursor: string;
  locale: string;
}) => {
  try {
    const query = `{
      translatableResources(resourceType: ${resourceType}, last: 20 ${startCursor ? `, before: "${startCursor}"` : ""}, reverse: true) {
        nodes {
          resourceId
          translatableContent {
            key
            digest
            locale
            type
            value
          }
          translations(locale: "${locale}") {
            key
            value
            outdated
          }
        }
        pageInfo {
          endCursor
          hasNextPage
          hasPreviousPage
          startCursor
        }
      }
    }`;

    const response = await axios({
      url: buildShopifyAdminGraphqlUrl(shop),
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken, // 确保使用正确的 Token 名称
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ query }),
    });
    const res = response.data.data.translatableResources;

    return res;
  } catch (error) {
    console.error(
      `Error fetching ${resourceType} queryPreviousTransType:`,
      error,
    );
  }
};

export const queryPrimaryMarket = async ({
  shop,
  accessToken,
}: {
  shop: string;
  accessToken: string;
}) => {
  try {
    const query = `{
      primaryMarket {
        webPresences(first: 10) {
          nodes {
            id
          }
        }
      }
    }`;

    const response = await axios({
      url: buildShopifyAdminGraphqlUrl(shop),
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken, // 确保使用正确的 Token 名称
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ query }),
    });

    const res = response.data?.data?.primaryMarket?.webPresences?.nodes;

    console.log(
      `${shop} queryPrimaryMarket: `,
      response.data?.data?.primaryMarket?.webPresences?.nodes,
    );

    return res || [];
  } catch (error) {
    console.error("Error queryPrimaryMarket:", error);
  }
};
export const mutationShopLocaleEnable = async ({
  shop,
  accessToken,
  source,
  targets,
}: {
  shop: string;
  accessToken: string;
  source: string; // 接受语言数组
  targets: string[];
}) => {
  try {
    const promises = targets?.map(async (language) => {
      const mutation = `
        mutation {
          shopLocaleEnable(locale: "${language}") {
            shopLocale {
              published
              primary
              name
              locale
            }
          }
        }
      `;
      try {
        const response = await axios({
          url: buildShopifyAdminGraphqlUrl(shop),
          method: "POST",
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
          data: JSON.stringify({ query: mutation }),
        });

        console.log("source: ", source);

        const res = response.data?.data?.shopLocaleEnable?.shopLocale;

        console.log(`${shop} mutationShopLocaleEnable: `, res);

        return res;
      } catch (error) {
        console.error(`${shop} add language ${language} failed: `, error);
        return undefined;
      }
    });

    const results = await Promise.allSettled(promises);

    console.log(results);

    return results;
  } catch (error) {
    console.error("Error mutationShopLocaleEnable:", error);
    return [];
  }
};

export const mutationShopLocaleDisable = async ({
  shop,
  accessToken,
  language,
}: {
  shop: string;
  accessToken: string | undefined;
  language: LanguagesDataType; // 接受语言数组
}) => {
  try {
    // 遍历语言数组并逐个执行 GraphQL mutation
    const mutation = `
        mutation {
          shopLocaleDisable(locale: "${language.locale}") {
            locale
          }
        }
      `;

    // 执行 API 请求
    const response = await axios({
      url: buildShopifyAdminGraphqlUrl(shop),
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      data: JSON.stringify({ query: mutation }),
    });

    const res = response.data.data.shopLocaleDisable.locale;
    return res || language.locale;
  } catch (error) {
    console.error("Error mutationShopLocaleDisable:", error);
  }
};

//创建一次性订单
export const mutationAppPurchaseOneTimeCreate = async ({
  shop,
  accessToken,
  name,
  price,
  test,
  returnUrl,
}: {
  shop: string;
  accessToken: string;
  name: string;
  price: {
    amount: number;
    currencyCode: string;
  };
  test?: boolean;
  returnUrl: URL;
}) => {
  try {
    // 执行 API 请求
    const response = await axios({
      url: buildShopifyAdminGraphqlUrl(shop),
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      data: {
        query: `mutation AppPurchaseOneTimeCreate($name: String!, $price: MoneyInput!, $returnUrl: URL! $test: Boolean) {
          appPurchaseOneTimeCreate(name: $name, returnUrl: $returnUrl, price: $price, test: $test) {
            userErrors {
              field
              message
            }
            appPurchaseOneTime {
              createdAt
              id
              name
              price {
                amount
                currencyCode
              }
              status
            }
            confirmationUrl
          }
        }`,
        variables: {
          name: `${name} Credits`,
          // Shopify 确认页对非法/空 returnUrl 会 500；必须传绝对 URL 字符串
          returnUrl:
            typeof returnUrl === "string" ? returnUrl : returnUrl.href,
          price: {
            amount: price.amount,
            currencyCode: price.currencyCode,
          },
          test: test || false,
        },
      },
    });

    const res = response.data;

    console.log(`${shop} mutationAppPurchaseOneTimeCreate: `, res);

    return res;
  } catch (error) {
    console.error("Error mutationAppPurchaseOneTimeCreate:", error);
    return null;
  }
};

//创建月度订阅订单
export const mutationAppSubscriptionCreate = async ({
  shop,
  accessToken,
  name,
  price,
  yearly,
  test,
  trialDays,
  returnUrl,
}: {
  shop: string;
  accessToken: string;
  name: string;
  yearly?: boolean;
  price: {
    amount: number;
    currencyCode: string;
  };
  test?: boolean;
  trialDays: number;
  returnUrl: URL;
}) => {
  try {
    // 执行 API 请求
    const response = await axios({
      url: buildShopifyAdminGraphqlUrl(shop),
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      data: {
        query: `mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $replacementBehavior: AppSubscriptionReplacementBehavior, $returnUrl: URL!, $trialDays: Int!, $test: Boolean) {
          appSubscriptionCreate(
            name: $name
            returnUrl: $returnUrl
            lineItems: $lineItems
            trialDays: $trialDays
            test: $test
            replacementBehavior: $replacementBehavior
          ) {
            userErrors {
              field
              message
            }
            appSubscription {
              id
              createdAt
              currentPeriodEnd
              name
              returnUrl
              status
              test
              trialDays
            }
            confirmationUrl
          }
        }`,
        variables: {
          name: `${name}`,
          // Shopify 确认页对非法/空 returnUrl 会 500；必须传绝对 URL 字符串
          returnUrl:
            typeof returnUrl === "string" ? returnUrl : returnUrl.href,
          lineItems: [
            {
              plan: {
                appRecurringPricingDetails: {
                  interval: yearly ? "ANNUAL" : "EVERY_30_DAYS",
                  price: {
                    amount: Number(price.amount),
                    currencyCode: price.currencyCode,
                  },
                },
              },
            },
          ],
          replacementBehavior: "APPLY_IMMEDIATELY",
          trialDays: Number(trialDays) || 0,
          test: test || false,
        },
      },
    });
    const res = response.data;

    console.log(`${shop} mutationAppSubscriptionCreate: `, res);

    return res;
  } catch (error) {
    console.error("Error mutationAppSubscriptionCreate:", error);
    return null;
  }
};
