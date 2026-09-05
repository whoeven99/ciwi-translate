import {
  Card,
  Divider,
  Input,
  Layout,
  Result,
  Space,
  Spin,
  Table,
  Typography,
} from "antd";
import Button from "~/ui/components/AppButton";
import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react"; // 引入 useNavigate
import { Page, Pagination, Select } from "@shopify/polaris";
import { ActionFunctionArgs, json } from "@remix-run/node";
import { SingleTextTranslate } from "~/api/translateV4Client";
import { registerManageTranslations } from "~/server/shopify/translations.server";
import ManageTranslationFieldRow from "~/components/manageTranslationFieldRow";
import SingleTranslateAction from "~/components/singleTranslateAction";
import { useSingleTranslateQuotaGate } from "~/hooks/useSingleTranslateQuotaGate";
import { authenticate } from "~/shopify.server";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { SaveBar } from "@shopify/app-bridge-react";
import { useContextualSaveBar } from "~/hooks/useContextualSaveBar";
import { runAfterSaveBarLeave } from "~/lib/saveBarNavigation";
import useReport from "scripts/eventReport";
import { globalStore } from "~/globalStore";
import { useConsumableFetcherData } from "~/hooks/useConsumableFetcherData";
import { SearchOutlined } from "@ant-design/icons";
import { getItemOptions } from "../app.manage_translation/route";
import {
  getManageTranslationLanguage,
  manageTranslationLanguageLoader,
} from "~/server/manageTranslation/manageTranslationRoute.server";
import {
  buildManageActionErrorResponse,
  getManageTranslationLoadErrorMessage,
} from "~/utils/manageTranslationErrors";
import {
  applyManageFlatTranslationUpdates,
  splitManageSaveResults,
} from "~/utils/manageSave";
import SideMenu from "~/components/sideMenu/sideMenu";

type MenuItem = { key: string; label: string };

const { Sider, Content } = Layout;

const { Title } = Typography;

const logGraphQLErrorDetail = (context: string, error: unknown) => {
  const e = error as any;
  const response = e?.response;
  const responseHeaders =
    typeof response?.headers?.get === "function"
      ? {
          requestId: response.headers.get("x-request-id"),
          apiVersion: response.headers.get("x-shopify-api-version"),
          apiVersionWarning: response.headers.get(
            "x-shopify-api-version-warning",
          ),
        }
      : undefined;

  const graphQLErrorList =
    (Array.isArray(e?.graphQLErrors) && e.graphQLErrors) ||
    (Array.isArray(e?.errors?.graphQLErrors) && e.errors.graphQLErrors) ||
    (Array.isArray(e?.body?.errors) && e.body.errors) ||
    [];

  const graphQLErrors = graphQLErrorList.map((gqlError: any) => ({
    message: gqlError?.message,
    path: gqlError?.path,
    extensions: gqlError?.extensions,
    locations: gqlError?.locations,
  }));
  console.error(`[${context}] GraphQL request failed`, {
    name: e?.name,
    message: e?.message,
    networkStatusCode: e?.networkStatusCode ?? e?.errors?.networkStatusCode,
    response: response
      ? {
          status: response?.status,
          statusText: response?.statusText,
          url: response?.url,
          headers: responseHeaders,
        }
      : undefined,
    stack: e?.stack,
  });
  console.error(
    `[${context}] graphQLErrors_full=${JSON.stringify(graphQLErrors, null, 2)}`,
  );
  graphQLErrors.forEach((item: any, index: number) => {
    console.error(`[${context}] graphQLError[${index}]`, item);
  });
  console.error(
    `[${context}] rawError_full=${JSON.stringify(
      e,
      Object.getOwnPropertyNames(e || {}),
      2,
    )}`,
  );
  console.error(`[${context}] rawError`, e);
};

type ManageDataSourceType = {
  key: string;
  resourceId: string;
  shopifyKey: string;
  index: number;
  resource: string;
  type: string;
  digest: string;
  default_language: string;
  translated: string | undefined;
  outdated?: boolean;
} | null;

export const loader = manageTranslationLanguageLoader;

export const action = async ({ request }: ActionFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { shop } = adminAuthResult.session;
  const { admin } = adminAuthResult;

  const searchTerm = getManageTranslationLanguage(request);

  const formData = await request.formData();
  const startCursor: any = JSON.parse(formData.get("startCursor") as string);
  const endCursor: any = JSON.parse(formData.get("endCursor") as string);
  const productId: any = formData.get("productId") as string;
  const variants: any = JSON.parse(formData.get("variants") as string);
  const confirmData: any[] = JSON.parse(formData.get("confirmData") as string);
  const refreshResourceIds: string[] = JSON.parse(
    (formData.get("refreshResourceIds") as string) || "[]",
  );

  if (startCursor) {
    try {
      const response = await admin.graphql(
        `#graphql
            query products($startCursor: String, $query: String) {     
              products(last: 20 ,before: $startCursor, query: $query, reverse: true) {
                nodes {
                  id
                  title
                  options(first: 20) {
                    optionValues {
                      id
                    }
                  }
                }
                pageInfo{
                  endCursor
                  startCursor
                  hasNextPage
                  hasPreviousPage
                }
              }
          }`,
        {
          variables: {
            startCursor: startCursor.cursor ? startCursor.cursor : undefined,
            query: startCursor.query ? startCursor.query : "",
          },
        },
      );

      const data = await response.json();

      return json({
        success: true,
        errorCode: 0,
        errorMsg: "",
        response: {
          data: data.data?.products?.nodes || [],
          pageInfo: data.data?.products?.pageInfo || {
            endCursor: "",
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: "",
          },
        },
      });
    } catch (error) {
      logGraphQLErrorDetail("Error action startCursor product", error);
      return json(
        buildManageActionErrorResponse(error, {
          fallbackErrorMsg: "",
        }),
      );
    }
  }

  if (endCursor) {
    try {
      const response = await admin.graphql(
        `#graphql
            query products($endCursor: String, $query: String) {     
              products(first: 20 ,after: $endCursor, query: $query, reverse: true) {
                nodes {
                  id
                  title
                  options(first: 20) {
                    optionValues {
                      id
                    }
                  }
                }
                pageInfo{
                  endCursor
                  startCursor
                  hasNextPage
                  hasPreviousPage
                }
              }
          }`,
        {
          variables: {
            endCursor: endCursor.cursor ? endCursor.cursor : undefined,
            query: endCursor.query ? endCursor.query : "",
          },
        },
      );

      const data = await response.json();

      return json({
        success: true,
        errorCode: 0,
        errorMsg: "",
        response: {
          data: data.data?.products?.nodes || [],
          pageInfo: data.data?.products?.pageInfo || {
            endCursor: "",
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: "",
          },
        },
      });
    } catch (error) {
      logGraphQLErrorDetail("Error action endCursor product", error);
      return json(
        buildManageActionErrorResponse(error, {
          fallbackErrorMsg: "",
        }),
      );
    }
  }

  if (productId) {
    if (!productId || productId === "undefined") {
      logGraphQLErrorDetail(
        "Error action productId product",
        new Error(`Invalid productId: ${productId}`),
      );
      return json({
        success: false,
        errorCode: 400,
        errorMsg: "Invalid Product ID provided.",
        response: null,
      });
    }
    try {
      let data: any;
      try {
        const response = await admin.graphql(
          `#graphql
              query {     
                translatableResource(resourceId: "${productId}") {
                    resourceId
                    translatableContent {
                      digest
                      key
                      locale
                      type
                      value
                    }
                    translations(locale: "${searchTerm}") {
                      value
                      outdated
                      key
                    }
                    options: nestedTranslatableResources(first: 20, resourceType: PRODUCT_OPTION) {
                      nodes {
                        resourceId
                        translatableContent {
                          digest
                          key
                          locale
                          type
                          value
                        }
                        translations(locale: "${searchTerm}") {
                          key
                          value
                          outdated
                        }
                      }
                    }
                    metafields: nestedTranslatableResources(first: 20, resourceType: METAFIELD) {
                      nodes {
                        resourceId
                        translatableContent {
                          digest
                          key
                          locale
                          type
                          value
                        }
                        translations(locale: "${searchTerm}") {
                          key
                          value
                          outdated
                        }
                      }
                    }
              }
            }`,
        );
        data = await response.json();
      } catch (error) {
        const message = (error as any)?.message || "";
        if (message.includes("Query not supported")) {
          // Some API versions/shops reject nestedTranslatableResources in this query shape.
          // Fall back to base resource query so the page still works.
          const fallbackResponse = await admin.graphql(
            `#graphql
                query {
                  translatableResource(resourceId: "${productId}") {
                    resourceId
                    translatableContent {
                      digest
                      key
                      locale
                      type
                      value
                    }
                    translations(locale: "${searchTerm}") {
                      value
                      outdated
                      key
                    }
                  }
                }`,
          );
          const fallbackData = await fallbackResponse.json();
          data = {
            ...fallbackData,
            data: {
              ...fallbackData?.data,
              translatableResource: {
                ...fallbackData?.data?.translatableResource,
                options: { nodes: [] },
                metafields: { nodes: [] },
              },
            },
          };
          console.warn(
            `[productId query fallback] Query not supported for nestedTranslatableResources, fallback to base query.`,
          );
        } else {
          throw error;
        }
      }

      return json({
        success: true,
        errorCode: 0,
        errorMsg: "",
        response: data.data?.translatableResource,
      });
    } catch (error) {
      logGraphQLErrorDetail("Error action productId product", error);
      return json(
        buildManageActionErrorResponse(error, {
          fallbackErrorMsg: "",
        }),
      );
    }
  }

  if (variants) {
    try {
      const promise = variants.data.map(async (variant: string) => {
        const response = await admin.graphql(
          `#graphql
                query {
                  translatableResourcesByIds(resourceIds: "${variant}", first: 1) {
                    nodes {
                      resourceId
                      translatableContent {
                        digest
                        key
                        locale
                        type
                        value
                      }
                      translations(locale: "${variants?.searchTerm || " "}") {
                        key
                        value
                        outdated
                      }
                    }
                  }
                }`,
        );
        return await response.json();
      });
      const variantsData = await Promise.allSettled(promise);
      return json({ variantsData: variantsData });
    } catch (error) {
      logGraphQLErrorDetail("Error action variants product", error);
      return buildManageActionErrorResponse(error);
    }
  }

  if (refreshResourceIds.length > 0) {
    try {
      const response = await admin.graphql(
        `#graphql
            query refreshProductResources($resourceIds: [ID!]!, $locale: String!) {
              translatableResourcesByIds(resourceIds: $resourceIds, first: 250) {
                nodes {
                  resourceId
                  translatableContent {
                    key
                    digest
                    locale
                    type
                    value
                  }
                  translations(locale: $locale) {
                    key
                    value
                    outdated
                  }
                }
              }
            }`,
        {
          variables: {
            resourceIds: refreshResourceIds,
            locale: searchTerm || "",
          },
        },
      );
      const data = await response.json();

      return {
        success: true,
        errorCode: 0,
        errorMsg: "",
        response: {
          nodes: data.data?.translatableResourcesByIds?.nodes || [],
          pageInfo: null,
        },
      };
    } catch (error) {
      logGraphQLErrorDetail("Error refreshing current page", error);
      return {
        ...buildManageActionErrorResponse(error),
        response: undefined,
      };
    }
  }

  if (confirmData) {
    const data = await registerManageTranslations({
      admin,
      shop,
      confirmData,
    });

    return {
      success: true,
      errorCode: 0,
      errorMsg: "",
      response: data,
    };
  }

  return buildManageActionErrorResponse();
};

const Index = () => {
  const { t } = useTranslation();
  const { handleSingleTranslateFailure, quotaGateModal } = useSingleTranslateQuotaGate();
  const navigate = useNavigate();
  const languageTableData = useSelector(
    (state: any) => state.languageTableData.rows,
  );

  const { searchTerm } = useLoaderData<typeof loader>();

  const isManualChangeRef = useRef(true);
  const loadingItemsRef = useRef<string[]>([]);
  const timeoutIdRef = useRef<any>();
  const refreshOrderRef = useRef<string[]>([]);

  const fetcher = useFetcher<any>();
  const dataFetcher = useFetcher<any>();
  const productFetcher = useFetcher<any>();
  const variantFetcher = useFetcher<any>();
  const { consume: consumeConfirmResponse } =
    useConsumableFetcherData<any>();
  const confirmFetcher = useFetcher<any>();

  const [isLoading, setIsLoading] = useState(true);

  const [menuData, setMenuData] = useState<MenuItem[]>([]);
  const [productsData, setProductsData] = useState<any>([]);
  const [productBaseData, setProductBaseData] = useState<any[]>([]);
  const [productSeoData, setProductSeoData] = useState<any[]>([]);
  const [optionsData, setOptionsData] = useState<any[]>([]);
  const [metafieldsData, setMetafieldsData] = useState<any[]>([]);
  const [variantsData, setVariantsData] = useState<any[]>([]);

  const [selectProductKey, setSelectProductKey] = useState<string>("");
  const [confirmData, setConfirmData] = useState<any[]>([]);
  const [variantsLoading, setVariantsLoading] = useState<boolean>(false);
  const [loadingItems, setLoadingItems] = useState<string[]>([]);
  const [successTranslatedKey, setSuccessTranslatedKey] = useState<string[]>(
    [],
  );
  const [translatedValues, setTranslatedValues] = useState<{
    [key: string]: string;
  }>({});
  const [queryText, setQueryText] = useState<string>("");
  const { reportClick } = useReport();
  const itemOptions = getItemOptions(t);
  const [languageOptions, setLanguageOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    searchTerm || "",
  );
  const [selectedItem, setSelectedItem] = useState<string>("product");
  const [hasPrevious, setHasPrevious] = useState<boolean>(false);
  const [hasNext, setHasNext] = useState<boolean>(false);
  const [startCursor, setStartCursor] = useState<string>("");
  const [endCursor, setEndCursor] = useState<string>("");
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    dataFetcher.submit(
      {
        endCursor: JSON.stringify({
          cursor: "",
          searchTerm: searchTerm,
          query: queryText,
        }),
      },
      {
        method: "post",
        action: `/app/manage_translation/product?language=${searchTerm}`,
      },
    );
    fetcher.submit(
      {
        log: `${globalStore?.shop} 目前在翻译管�?产品页面`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (dataFetcher.data) {
      if (dataFetcher.data.success) {
        // 处理刷新操作返回的数据（包含 nodes�?
        if (dataFetcher.data.response?.nodes) {
          // 刷新操作：更新当前产品的翻译数据
          const refreshedNodes = dataFetcher.data.response.nodes;

          // 更新产品基础数据
          setProductBaseData((prevData) =>
            prevData.map((item) => {
              const refreshedNode = refreshedNodes.find(
                (node: any) => node.resourceId === item.resourceId,
              );
              if (refreshedNode) {
                const translatableContent =
                  refreshedNode.translatableContent?.find(
                    (c: any) => c.key === item.shopifyKey,
                  );
                const translation = refreshedNode.translations?.find(
                  (t: any) => t.key === item.shopifyKey,
                );
                return {
                  ...item,
                  digest: translatableContent?.digest || item.digest,
                  translated: translation?.value || item.translated,
                  default_language:
                    translatableContent?.value || item.default_language,
                };
              }
              return item;
            }),
          );

          // 更新 SEO 数据
          setProductSeoData((prevData) =>
            prevData.map((item) => {
              const refreshedNode = refreshedNodes.find(
                (node: any) => node.resourceId === item.resourceId,
              );
              if (refreshedNode) {
                const translatableContent =
                  refreshedNode.translatableContent?.find(
                    (c: any) => c.key === item.shopifyKey,
                  );
                const translation = refreshedNode.translations?.find(
                  (t: any) => t.key === item.shopifyKey,
                );
                return {
                  ...item,
                  digest: translatableContent?.digest || item.digest,
                  translated: translation?.value || item.translated,
                  default_language:
                    translatableContent?.value || item.default_language,
                };
              }
              return item;
            }),
          );

          setTimeout(() => {
            setIsLoading(false);
          }, 100);
          return;
        }

        // 处理常规分页请求返回的数据（包含 data�?
        let refreshedData = dataFetcher.data.response.data;
        if (refreshOrderRef.current.length > 0) {
          refreshedData.sort((a: any, b: any) => {
            return (
              refreshOrderRef.current.indexOf(a.id) -
              refreshOrderRef.current.indexOf(b.id)
            );
          });
          refreshOrderRef.current = []; // Reset the ref
        }
        const menuData = refreshedData.map((item: any) => {
          return {
            key: item.id,
            label: item.title,
          };
        });
        setMenuData(menuData);
        setSelectProductKey(refreshedData[0]?.id);
        setHasPrevious(dataFetcher.data.response.pageInfo.hasPreviousPage);
        setHasNext(dataFetcher.data.response.pageInfo.hasNextPage);
        setStartCursor(dataFetcher.data.response.pageInfo.startCursor);
        setEndCursor(dataFetcher.data.response.pageInfo.endCursor);
        setProductsData(refreshedData);
        setTimeout(() => {
          setIsLoading(false);
        }, 100);
      }
    }
  }, [dataFetcher.data]);
  useEffect(() => {
    if (!dataFetcher.data || dataFetcher.data.success) return;
    setIsLoading(false);
    shopify.toast.show(
      getManageTranslationLoadErrorMessage(t, dataFetcher.data?.errorMsg),
    );
  }, [dataFetcher.data, t]);


  // 更新 loadingItemsRef 的�?
  useEffect(() => {
    loadingItemsRef.current = loadingItems;
  }, [loadingItems]);

  useEffect(() => {
    if (languageTableData) {
      setLanguageOptions(
        languageTableData
          .filter((item: any) => !item.primary)
          .map((item: any) => ({
            label: item.name,
            value: item.locale,
          })),
      );
    }
  }, [languageTableData]);

  useEffect(() => {
    if (!selectProductKey) {
      setProductBaseData([]);
      setProductSeoData([]);
      setOptionsData([]);
      setMetafieldsData([]);
      setVariantsData([]);
      return;
    }
    setProductBaseData([]);
    setProductSeoData([]);
    setOptionsData([]);
    setMetafieldsData([]);
    setVariantsData([]);
    setLoadingItems([]);
    setConfirmData([]);
    setSuccessTranslatedKey([]);
    setTranslatedValues({});
    productFetcher.submit(
      {
        productId: selectProductKey,
      },
      {
        method: "POST",
      },
    );
    const variants = productsData
      .find((item: any) => item.id === selectProductKey)
      ?.options.flatMap((item: any) =>
        item.optionValues.map((opt: any) => opt.id),
      );
    if (variants && Array.isArray(variants)) {
      variantFetcher.submit(
        {
          variants: JSON.stringify({
            data: variants,
            searchTerm: searchTerm,
          }),
        },
        {
          method: "post",
          action: "/app/manage_translation/product",
        },
      );
    } else {
      setVariantsLoading(false);
    }
  }, [selectProductKey, productsData]);

  useEffect(() => {
    if (productFetcher.data) {
      if (productFetcher.data.success) {
        const response = productFetcher.data.response;
        const resourceId = response?.resourceId;
        // 先把 translatableContent / translations 建成�?key 索引的查找表�?
        // 避免每个字段都对同一数组反复 .find()（原来每行扫 4 次）
        const contentByKey = new Map<string, any>(
          (response?.translatableContent ?? []).map((c: any) => [c.key, c]),
        );
        const translationByKey = new Map<string, any>(
          (response?.translations ?? []).map((tr: any) => [tr.key, tr]),
        );
        // emptyTranslated=true 时缺失译文回退�?""（SEO 行的原行为），否则保�?undefined（基础行的原行为）
        const buildRow = (
          shopifyKey: string,
          resource: string,
          idx: number,
          emptyTranslated = false,
        ) => {
          const content = contentByKey.get(shopifyKey);
          const translation = translationByKey.get(shopifyKey);
          return {
            key: `${shopifyKey}_${resourceId}_${idx}`,
            resourceId,
            shopifyKey,
            index: 4,
            resource,
            digest: content?.digest || "",
            type: content?.type || "",
            default_language: content?.value || "",
            translated: emptyTranslated
              ? translation?.value || ""
              : translation?.value,
            outdated: translation?.outdated === true,
          };
        };
        setProductBaseData(
          [
            buildRow("title", t("Title"), 0),
            buildRow("body_html", t("Description"), 1),
            buildRow("product_type", t("ProductType"), 2),
          ].filter((item) => item.default_language),
        );
        setProductSeoData(
          [
            buildRow("handle", t("URL handle"), 0, true),
            buildRow("meta_title", t("Meta title"), 1, true),
            buildRow("meta_description", t("Meta description"), 2, true),
          ].filter((item) => item.default_language),
        );
        const optionsData = productFetcher.data.response?.options?.nodes
          ?.filter(
            (item: any) =>
              item?.translatableContent[0]?.value !== "Title" &&
              item?.translatableContent[0]?.value,
          )
          ?.map((option: any, index: number) => {
            return {
              key: `${option?.translatableContent[0]?.key}_${option?.resourceId}_${index}`,
              resourceId: option?.resourceId,
              shopifyKey: option?.translatableContent[0]?.key,
              index: index,
              digest: option?.translatableContent[0]?.digest,
              resource: t(option?.translatableContent[0]?.value),
              type: option?.translatableContent[0]?.type,
              default_language: option?.translatableContent[0]?.value,
              translated: option?.translations[0]?.value,
              outdated: option?.translations[0]?.outdated === true,
            };
          });
        if (optionsData) setOptionsData(optionsData);
        const metafieldsData =
          productFetcher.data.response?.metafields?.nodes?.map(
            (metafield: any, index: number) => {
              return {
                key: `${metafield?.translatableContent[0]?.key}_${metafield?.resourceId}_${index}`,
                resourceId: metafield?.resourceId,
                shopifyKey: metafield?.translatableContent[0]?.key,
                index: index,
                digest: metafield?.translatableContent[0]?.digest,
                resource: t(metafield?.translatableContent[0]?.key),
                type: metafield?.translatableContent[0]?.type,
                default_language: metafield?.translatableContent[0]?.value,
                translated: metafield?.translations[0]?.value,
                outdated: metafield?.translations[0]?.outdated === true,
              };
            },
          );
        if (metafieldsData) setMetafieldsData(metafieldsData);
      } else {
        shopify.toast.show(
          getManageTranslationLoadErrorMessage(t, productFetcher.data?.errorMsg),
        );
      }
    }
  }, [productFetcher.data, t]);

  useEffect(() => {
    const data = consumeConfirmResponse(confirmFetcher.data);
    if (!data?.success) return;

    const { failedItems, successfulItems, hasInvalidDigestError } =
      splitManageSaveResults(data.response);

    if (successfulItems.length) {
      setProductBaseData((prev) =>
        applyManageFlatTranslationUpdates(prev, successfulItems),
      );
      setProductSeoData((prev) =>
        applyManageFlatTranslationUpdates(prev, successfulItems),
      );
      setOptionsData((prev) =>
        applyManageFlatTranslationUpdates(prev, successfulItems),
      );
      setMetafieldsData((prev) =>
        applyManageFlatTranslationUpdates(prev, successfulItems),
      );
      setVariantsData((prev) =>
        applyManageFlatTranslationUpdates(prev, successfulItems),
      );
    }

    if (failedItems.length === 0) {
        shopify.toast.show(t("Saved successfully"));
        fetcher.submit(
          {
            log: `${globalStore?.shop} 翻译管理-产品页面修改数据保存成功`,
          },
          {
            method: "POST",
            action: "/log",
          },
        );
      } else {
        shopify.toast.show(t("Some items saved failed"));
        if (hasInvalidDigestError || successfulItems.length > 0) {
          refreshCurrentPageData();
        }
      }

    setConfirmData([]);
    setSuccessTranslatedKey([]);
  }, [confirmFetcher.data, consumeConfirmResponse, fetcher, t]);

  useEffect(() => {
    if (variantFetcher.data && variantFetcher.data.variantsData) {
      const variantsData = variantFetcher.data.variantsData.flatMap(
        (result: any, index: number) => {
          if (result.status === "fulfilled") {
            return result.value.data.translatableResourcesByIds.nodes
              .filter(
                (variant: any) =>
                  variant?.translatableContent[0]?.value &&
                  variant?.translatableContent[0]?.value !== "Default Title",
              )
              .map((variant: any) => ({
                key: `${variant?.translatableContent[0]?.key}_${variant?.resourceId}_${index}`,
                resourceId: variant?.resourceId,
                shopifyKey: variant?.translatableContent[0]?.key,
                index,
                resource: t(variant?.translatableContent[0]?.key),
                type: variant?.translatableContent[0]?.type,
                digest: variant?.translatableContent[0]?.digest,
                default_language: variant?.translatableContent[0]?.value,
                translated: variant?.translations[0]?.value,
                outdated: variant?.translations[0]?.outdated === true,
              }));
          } else {
            console.error("Request failed:", result.reason);
          }
          return []; // 记得返回空数组避�?undefined
        },
      );

      if (variantsData) setVariantsData(variantsData);
      setVariantsLoading(false);
    }
  }, [variantFetcher.data]);

  useContextualSaveBar("save-bar", confirmData.length > 0);

  const renderTranslateAction = (
    record: ManageDataSourceType,
    resourceType: string,
    trackClick = false,
  ) => {
    if (!record) return null;

    return (
      <SingleTranslateAction
        triggerProps={{
          type: "default",
          size: "small",
          style: {
            height: 22,
            paddingInline: 6,
            fontWeight: 500,
            fontSize: 12,
            lineHeight: 1,
            color: "var(--app-accent-primary)",
            borderColor: "var(--app-accent-primary)",
            borderRadius: 6,
            backgroundColor: "var(--p-color-bg-surface)",
            whiteSpace: "nowrap",
          },
        }}
        loading={loadingItems.includes(record?.key || "")}
        existingTranslation={
          translatedValues[record?.key || ""] ?? record?.translated
        }
        sourceText={record?.default_language ?? ""}
        targetLocale={searchTerm || ""}
        fieldKey={record?.shopifyKey || record?.key || "value"}
        isOutdated={record?.outdated === true}
        onSubmit={({ customPrompt, aiModel }) => {
          handleTranslate({
            resourceType,
            record,
            handleInputChange,
            customPrompt,
            aiModel,
          });
          if (trackClick) {
            reportClick("editor_list_translate");
          }
        }}
      />
    );
  };

  const renderManageField = (
    record: ManageDataSourceType,
    resourceType: string,
    options?: {
      isHtml?: boolean;
      stacked?: boolean;
      trackClick?: boolean;
    },
  ) => {
    if (!record) return null;

    return (
      <ManageTranslationFieldRow
        record={record}
        isHtml={options?.isHtml}
        isSuccess={successTranslatedKey?.includes(record?.key as string)}
        translatedValues={translatedValues}
        setTranslatedValues={setTranslatedValues}
        handleInputChange={handleInputChange}
        isRtl={searchTerm === "ar"}
        stacked={options?.stacked}
        sourceLabel={t("Default Language")}
        translatedLabel={t("Translated")}
        action={renderTranslateAction(
          record,
          resourceType,
          options?.trackClick ?? false,
        )}
      />
    );
  };

  const renderMobileSection = (
    title: string,
    data: any[],
    resourceType: string,
    options?: {
      isHtml?: (record: ManageDataSourceType) => boolean;
      trackClick?: boolean;
    },
  ) => {
    if (!Array.isArray(data) || data[0] === undefined) return null;

    return (
      <Card title={title}>
        <Space direction="vertical" style={{ width: "100%" }}>
          {data.map((item: any, index: number) => (
            <Space
              key={index}
              direction="vertical"
              size="small"
              style={{ width: "100%" }}
            >
              {renderManageField(item, resourceType, {
                isHtml: options?.isHtml?.(item) ?? false,
                stacked: true,
                trackClick: options?.trackClick,
              })}
              <Divider
                style={{
                  margin: "8px 0",
                }}
              />
            </Space>
          ))}
        </Space>
      </Card>
    );
  };

  const productBaseDataColumns = [
    {
      title: t("Resource"),
      key: "resource",
      render: (_: any, record: ManageDataSourceType) =>
        renderManageField(record, "PRODUCT", {
          isHtml: record?.shopifyKey == "body_html",
        }),
    },
  ];

  const productSeoDataColumns = [
    {
      title: t("Seo"),
      key: "seo",
      render: (_: any, record: ManageDataSourceType) =>
        renderManageField(record, "PRODUCT"),
    },
  ];

  const optionsColumns = [
    {
      title: t("Product Options"),
      key: "product-options",
      render: (_: any, record: ManageDataSourceType) =>
        renderManageField(record, "PRODUCT_OPTION"),
    },
  ];

  const metafieldsColumns = [
    {
      title: t("Metafield"),
      key: "metafield",
      render: (_: any, record: ManageDataSourceType) =>
        renderManageField(record, "METAFIELD"),
    },
  ];

  const variantsColumns = [
    {
      title: t("OptionValue"),
      key: "option-value",
      render: (_: any, record: ManageDataSourceType) =>
        renderManageField(record, "PRODUCT_OPTION_VALUE"),
    },
  ];

  // useCallback 稳定函数引用，配�?ManageTableInput �?React.memo�?
  // 避免 loadingItems/分页/菜单等无关状态变化时整表单元格重渲染
  const handleInputChange = useCallback(
    (record: any, value: string) => {
      setTranslatedValues((prev) => ({
        ...prev,
        [record?.key]: value, // 更新对应�?key
      }));
      setConfirmData((prevData) => {
        const existingItemIndex = prevData.findIndex(
          (item) => item.id === record?.key,
        );
        if (existingItemIndex !== -1) {
          // 如果 key 存在，更新其对应�?value
          const updatedConfirmData = [...prevData];
          updatedConfirmData[existingItemIndex] = {
            ...updatedConfirmData[existingItemIndex],
            value: value,
          };
          return updatedConfirmData;
        } else {
          const newItem = {
            id: record?.key,
            resourceId: record?.resourceId,
            locale: globalStore?.source || "",
            key: record?.shopifyKey,
            value: value, // 初始为空字符�?
            translatableContentDigest: record?.digest,
            target: searchTerm || "",
          };

          return [...prevData, newItem]; // 将新数据添加�?confirmData �?
        }
      });
    },
    [searchTerm],
  );

  const handleTranslate = async ({
    resourceType,
    record,
    handleInputChange,
    customPrompt,
    aiModel,
  }: {
    resourceType: string;
    record: any;
    handleInputChange: (record: any, value: string) => void;
    customPrompt?: string;
    aiModel?: string;
  }) => {
    fetcher.submit(
      {
        log: `${globalStore?.shop} 从翻译管�?产品页面点击单行翻译`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
    setLoadingItems((prev) => [...prev, record?.key]);

    const data = await SingleTextTranslate({
      shopName: globalStore?.shop || "",
      source: globalStore?.source || "",
      target: searchTerm || "",
      resourceType: resourceType,
      context: record?.default_language,
      key: record?.shopifyKey,
      type: record?.type,
      resourceId: record?.resourceId,
      customPrompt,
      aiModel,
    });
    if (data?.success) {
      if (loadingItemsRef.current.includes(record?.key)) {
        handleInputChange(record, data.response);
        setSuccessTranslatedKey((prev) => [...prev, record?.key]);
        shopify.toast.show(t("Translated successfully"));
        fetcher.submit(
          {
            log: `${globalStore?.shop} 从翻译管�?产品页面点击单行翻译返回结果 ${data?.response}`,
          },
          {
            method: "POST",
            action: "/log",
          },
        );
      }
    } else {
      handleSingleTranslateFailure(data.errorMsg);
    }
    setLoadingItems((prev) => prev.filter((item) => item !== record?.key));
  };

  const handleLanguageChange = (language: string) => {
    runAfterSaveBarLeave(() => {
      setIsLoading(true);
      dataFetcher.submit(
        {
          endCursor: JSON.stringify({
            cursor: "",
            searchTerm: searchTerm,
            query: queryText,
          }),
        },
        {
          method: "post",
          action: `/app/manage_translation/product?language=${language}`,
        },
      );
      isManualChangeRef.current = true;
      setSelectedLanguage(language);
      navigate(`/app/manage_translation/product?language=${language}`);
    });
  };

  const handleItemChange = (item: string) => {
    runAfterSaveBarLeave(() => {
      setIsLoading(true);
      isManualChangeRef.current = true;
      setSelectedItem(item);
      navigate(`/app/manage_translation/${item}?language=${searchTerm}`);
    });
  };

  // 节流函数
  const throttle = (func: Function, delay: number) => {
    let lastTime = 0;
    return (...args: any[]) => {
      const now = Date.now();
      if (now - lastTime >= delay) {
        func(...args);
        lastTime = now;
      }
    };
  };

  // 下一页请求函�?
  const throttleNextSubmit = useMemo(() => {
    return throttle(async () => {
      dataFetcher.submit(
        {
          endCursor: JSON.stringify({
            cursor: endCursor,
            searchTerm: searchTerm,
            query: queryText,
          }),
        },
        {
          method: "post",
          action: `/app/manage_translation/product?language=${searchTerm}`,
        },
      ); // 提交表单请求
    }, 500);
  }, [productsData, searchTerm]);

  // 上一页请求函�?
  const throttleBackSubmit = useMemo(() => {
    return throttle(() => {
      dataFetcher.submit(
        {
          startCursor: JSON.stringify({
            cursor: startCursor,
            searchTerm: searchTerm,
            query: queryText,
          }),
        },
        {
          method: "post",
          action: `/app/manage_translation/product?language=${searchTerm}`,
        },
      );
    }, 500);
  }, [productsData, searchTerm]); // �?必须写依�?

  const throttleMenuChange = useMemo(() => {
    return throttle((key: string) => {
      setSelectProductKey(key);
    }, 300);
  }, []);

  const clickNextTimestampsRef = useRef<number[]>([]); // 用于存储点击时间�?
  const clickBackTimestampsRef = useRef<number[]>([]); // 用于存储点击时间�?

  const handleMenuChange = (key: string) => {
    runAfterSaveBarLeave(() => {
      throttleMenuChange(key);
    });
  };

  const handleSearch = (value: string) => {
    setQueryText(value);

    // 清除上一次的定时�?
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
    }

    // 延迟 0.5s 再执行请�?
    timeoutIdRef.current = setTimeout(() => {
      dataFetcher.submit(
        {
          endCursor: JSON.stringify({
            cursor: "",
            searchTerm: searchTerm,
            query: value,
          }),
        },
        {
          method: "post",
          action: `/app/manage_translation/product?language=${searchTerm}`,
        },
      );
    }, 500);
  };

  const onPrevious = () => {
    runAfterSaveBarLeave(() => {
      const now = Date.now();
      clickBackTimestampsRef.current.push(now);
      const recent = clickBackTimestampsRef.current.filter(
        (ts) => now - ts < 2000,
      );
      clickBackTimestampsRef.current = recent;
      if (recent.length >= 5) {
        shopify.toast.show(
          t("You clicked too frequently. Please try again later."),
        );
        return;
      }
      throttleBackSubmit();
    });
  };

  const refreshCurrentPageData = () => {
    const currentResourceIds = productsData
      .map((item: any) => item?.id)
      .filter(Boolean);

    if (currentResourceIds.length === 0) return;
    refreshOrderRef.current = currentResourceIds;
    setIsLoading(true);
    dataFetcher.submit(
      {
        refreshResourceIds: JSON.stringify(currentResourceIds),
      },
      {
        method: "post",
        action: `/app/manage_translation/product?language=${selectedLanguage}`,
      },
    );
  };
  const onNext = () => {
    runAfterSaveBarLeave(() => {
      const now = Date.now();
      clickNextTimestampsRef.current.push(now);
      const recent = clickNextTimestampsRef.current.filter(
        (ts) => now - ts < 2000,
      );
      clickNextTimestampsRef.current = recent;
      if (recent.length >= 5) {
        shopify.toast.show(
          t("You clicked too frequently. Please try again later."),
        );
        return;
      }
      throttleNextSubmit();
    });
  };

  const handleConfirm = () => {
    const formData = new FormData();
    formData.append("confirmData", JSON.stringify(confirmData)); // 将选中的语言作为字符串发�?
    confirmFetcher.submit(formData, {
      method: "post",
      action: `/app/manage_translation/product?language=${searchTerm}`,
    }); // 提交表单请求
    fetcher.submit(
      {
        log: `${globalStore?.shop} 提交翻译管理-产品页面修改数据`,
      },
      {
        method: "POST",
        action: "/log",
      },
    );
  };

  const handleDiscard = () => {
    const productBaseNewData = JSON.parse(JSON.stringify(productBaseData));

    setProductBaseData(productBaseNewData);
    const productSeoNewData = JSON.parse(JSON.stringify(productSeoData));

    setProductSeoData(productSeoNewData);
    const optionsNewData = JSON.parse(JSON.stringify(optionsData));

    setOptionsData(optionsNewData);
    const metafieldsNewData = JSON.parse(JSON.stringify(metafieldsData));

    setMetafieldsData(metafieldsNewData);
    const variantsNewData = JSON.parse(JSON.stringify(variantsData));

    setVariantsData(variantsNewData);

    setConfirmData([]);
    setSuccessTranslatedKey([]);
  };

  const onCancel = () => {
    runAfterSaveBarLeave(() => {
      navigate(`/app/manage_translation?language=${searchTerm}`); // 跳转�?/app/manage_translation
    });
  };

  return (
    <Page
      title={t("Products")}
      fullWidth={true}
      backAction={{
        onAction: onCancel,
      }}
    >
      <SaveBar id="save-bar">
        <button
          variant="primary"
          onClick={handleConfirm}
          disabled={confirmFetcher.state === "submitting"}
        >
          {t("Save")}
        </button>
        <button onClick={handleDiscard}>{t("Discard")}</button>
      </SaveBar>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          marginBottom: "15px",
          gap: "8px",
        }}
      >
        <Input
          placeholder={t("Search...")}
          prefix={<SearchOutlined />}
          value={queryText}
          onChange={(e) => handleSearch(e.target.value)}
        />
        <div
          style={{
            width: "100px",
          }}
        >
          <Select
            label={""}
            options={languageOptions}
            value={selectedLanguage}
            onChange={(value) => handleLanguageChange(value)}
          />
        </div>
        <div
          style={{
            width: "100px",
          }}
        >
          <Select
            label={""}
            options={itemOptions}
            value={selectedItem}
            onChange={(value) => handleItemChange(value)}
          />
        </div>
      </div>
      <Layout
        style={{
          overflow: "auto",
          backgroundColor: "var(--p-color-bg)",
          minHeight: "70vh",
        }}
      >
        {isLoading ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            <Spin />
          </div>
        ) : productsData.length ? (
          <>
            {!isMobile && (
              <Sider
                style={{
                  minHeight: "70vh",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "auto",
                  backgroundColor: "var(--p-color-bg)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
minHeight: 0,
justifyContent: "space-between",
                  }}
                >
                  <SideMenu
                    defaultSelectedKeys={productsData[0]?.id}
                    items={menuData}
                    selectedKeys={selectProductKey}
                    onClick={handleMenuChange}
                  />
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {(hasNext || hasPrevious) && (
                      <Pagination
                        hasPrevious={hasPrevious}
                        onPrevious={onPrevious}
                        hasNext={hasNext}
                        onNext={onNext}
                      />
                    )}
                  </div>
                </div>
              </Sider>
            )}
            <Content
              style={{
                paddingLeft: isMobile ? "16px" : "24px",
                minHeight: "70vh",
                display: "flex",
                flexDirection: "column",
                overflow: "auto",
              }}
            >
              {isMobile ? (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Title
                    level={4}
                    style={{
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {
                      menuData!.find(
                        (item: any) => item.key === selectProductKey,
                      )?.label
                    }
                  </Title>
                  {renderMobileSection(
                    t("Resource"),
                    productBaseData,
                    "PRODUCT",
                    {
                      isHtml: (record) => record?.shopifyKey == "body_html",
                    },
                  )}
                  {renderMobileSection(t("Seo"), productSeoData, "PRODUCT")}
                  {renderMobileSection(
                    t("Product Options"),
                    optionsData,
                    "PRODUCT_OPTION",
                    {
                      trackClick: true,
                    },
                  )}
                  {renderMobileSection(
                    t("Metafield"),
                    metafieldsData,
                    "METAFIELD",
                    {
                      trackClick: true,
                    },
                  )}
                  {renderMobileSection(
                    t("OptionValue"),
                    variantsData,
                    "PRODUCT_OPTION_VALUE",
                    {
                      trackClick: true,
                    },
                  )}
                  <SideMenu
                    defaultSelectedKeys={productsData[0]?.id}
                    items={menuData}
                    selectedKeys={selectProductKey}
                    onClick={handleMenuChange}
                  />
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {(hasNext || hasPrevious) && (
                      <Pagination
                        hasPrevious={hasPrevious}
                        onPrevious={onPrevious}
                        hasNext={hasNext}
                        onNext={onNext}
                      />
                    )}
                  </div>
                </Space>
              ) : !productBaseData.length ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    height: "100%",
                  }}
                >
                  <Spin />
                </div>
              ) : (
                <Space
                  direction="vertical"
                  size="large"
                  style={{ width: "100%" }}
                >
                  <Title
                    level={4}
                    style={{
                      margin: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {
                      menuData!.find(
                        (item: any) => item.key === selectProductKey,
                      )?.label
                    }
                  </Title>
                  <Table
                    columns={productBaseDataColumns}
                    dataSource={productBaseData}
                    pagination={false}
                  />
                  <Table
                    columns={productSeoDataColumns}
                    dataSource={productSeoData}
                    pagination={false}
                  />
                  {Array.isArray(optionsData) &&
                    optionsData[0] !== undefined && (
                      <Table
                        columns={optionsColumns}
                        dataSource={optionsData}
                        pagination={false}
                      />
                    )}
                  {Array.isArray(metafieldsData) &&
                    metafieldsData[0] !== undefined && (
                      <Table
                        columns={metafieldsColumns}
                        dataSource={metafieldsData}
                        pagination={false}
                      />
                    )}
                  {Array.isArray(variantsData) &&
                    variantsData[0] !== undefined && (
                      <Table
                        loading={
                          variantFetcher.state === "submitting" ||
                          variantsLoading
                        }
                        columns={variantsColumns}
                        dataSource={variantsData}
                        pagination={false}
                      />
                    )}
                </Space>
              )}
            </Content>
          </>
        ) : (
          <Result
            title={t("The specified fields were not found in the store.")}
            extra={
              <Button type="primary" onClick={onCancel}>
                {t("Yes")}
              </Button>
            }
          />
        )}
      </Layout>
      {quotaGateModal}
    </Page>
  );
};

export default Index;
