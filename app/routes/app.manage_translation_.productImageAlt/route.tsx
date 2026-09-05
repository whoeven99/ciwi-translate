import { ActionFunctionArgs } from "@remix-run/node";
import { json, useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { SaveBar } from "@shopify/app-bridge-react";
import { useContextualSaveBar } from "~/hooks/useContextualSaveBar";
import { runAfterSaveBarLeave } from "~/lib/saveBarNavigation";
import { Page, Pagination, Select } from "@shopify/polaris";
import {
  Card,
  Layout,
  Space,
  Spin,
  Image,
  Typography,
  Divider,
  Table,
  Input,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { authenticate } from "~/shopify.server";
import {
  GetProductImageData,
  UpdateProductImageAltData,
} from "~/api/pictureClient";
import { SingleTextTranslate } from "~/api/translateV4Client";
import { sameShopifyImageUrl } from "~/utils/shopifyImageUrl";
import { globalStore } from "~/globalStore";
import { getItemOptions } from "../app.manage_translation/route";
import {
  manageTranslationLanguageLoader,
} from "~/server/manageTranslation/manageTranslationRoute.server";
import { logManageTranslationGraphQLErrorDetail } from "~/utils/manageTranslationErrors";
import useReport from "scripts/eventReport";
import styles from "./styles.module.css";
import SideMenu from "~/components/sideMenu/sideMenu";
import SingleTranslateAction from "~/components/singleTranslateAction";
import { useSingleTranslateQuotaGate } from "~/hooks/useSingleTranslateQuotaGate";

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

export const loader = manageTranslationLanguageLoader;

export const action = async ({ request }: ActionFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { admin } = adminAuthResult;

  const formData = await request.formData();
  const loading: any = JSON.parse(formData.get("loading") as string);
  const productStartCursor: any = JSON.parse(
    formData.get("productStartCursor") as string,
  );
  const productEndCursor: any = JSON.parse(
    formData.get("productEndCursor") as string,
  );
  const imageStartCursor: any = JSON.parse(
    formData.get("imageStartCursor") as string,
  );
  const imageEndCursor: any = JSON.parse(
    formData.get("imageEndCursor") as string,
  );

  if (loading) {
    try {
      const loadData = await admin.graphql(
        `query {
          products(first: 20, reverse: true) {
            edges {
              node {
                id
                title
                images(first: 20) {
                  edges {
                    node {
                      id
                      url
                      altText
                    }
                  }
                  pageInfo {
                      hasNextPage
                      hasPreviousPage
                      startCursor
                      endCursor
                  }
                }
              }
            } 
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
          }
        }`,
      );
      const response = await loadData.json();
      console.log("loadData", response?.data?.products?.edges);
      if (response?.data?.products?.edges.length > 0) {
        const menuData = response?.data?.products?.edges.map((item: any) => {
          return {
            key: item?.node?.id,
            label: item?.node?.title,
          };
        });
        const imageData = response?.data?.products?.edges.map((item: any) => {
          return item?.node?.images?.edges.map((image: any) => {
            return {
              key: image?.node?.id,
              productId: item?.node?.id,
              productTitle: item?.node?.title,
              imageUrl: image?.node?.url,
              imageId: image?.node?.id,
              altText: image?.node?.altText,
              targetAltText: "",
              imageStartCursor: item?.node?.images?.pageInfo?.startCursor,
              imageEndCursor: item?.node?.images?.pageInfo?.endCursor,
              imageHasNextPage: item?.node?.images?.pageInfo?.hasNextPage,
              imageHasPreviousPage:
                item?.node?.images?.pageInfo?.hasPreviousPage,
            };
          });
        });
        return json({
          menuData,
          imageData,
          productStartCursor: response?.data?.products?.pageInfo?.startCursor,
          productEndCursor: response?.data?.products?.pageInfo?.endCursor,
          productHasNextPage: response?.data?.products?.pageInfo?.hasNextPage,
          productHasPreviousPage:
            response?.data?.products?.pageInfo?.hasPreviousPage,
        });
      }

      return json({
        menuData: [],
        imageData: [],
        productStartCursor: "",
        productEndCursor: "",
        productHasNextPage: "",
        productHasPreviousPage: "",
      });
    } catch (error) {
      logManageTranslationGraphQLErrorDetail(
        "Error action loadData productImage",
        error,
      );
      return json({
        menuData: [],
        imageData: [],
        productStartCursor: "",
        productEndCursor: "",
        productHasNextPage: "",
        productHasPreviousPage: "",
      });
    }
  }

  if (productStartCursor) {
    try {
      const loadData = await admin.graphql(
        `query {
            products(last: 20, before: "${productStartCursor?.productsStartCursor}", reverse: true) {
              edges {
                node {    
                  id
                  title
                  images(first: 20) {
                    edges {
                      node {
                        id    
                        url
                        altText
                      }
                    }
                    pageInfo {
                      hasNextPage
                      hasPreviousPage
                      startCursor
                      endCursor
                    }
                  }
                }
              }   
              pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
              }
            }
          }`,
      );
      const response = await loadData.json();
      console.log("productStartCursor", response?.data?.products?.edges);
      if (response?.data?.products?.edges.length > 0) {
        const menuData = response?.data?.products?.edges.map((item: any) => {
          return {
            key: item?.node?.id,
            label: item?.node?.title,
          };
        });
        const imageData = response?.data?.products?.edges.map((item: any) => {
          return item?.node?.images?.edges.map((image: any) => {
            return {
              key: image?.node?.id,
              productId: item?.node?.id,
              productTitle: item?.node?.title,
              imageUrl: image?.node?.url,
              imageId: image?.node?.id,
              altText: image?.node?.altText,
              targetAltText: "",
              imageStartCursor: item?.node?.images?.pageInfo?.startCursor,
              imageEndCursor: item?.node?.images?.pageInfo?.endCursor,
              imageHasNextPage: item?.node?.images?.pageInfo?.hasNextPage,
              imageHasPreviousPage:
                item?.node?.images?.pageInfo?.hasPreviousPage,
            };
          });
        });
        return json({
          menuData,
          imageData,
          productStartCursor: response?.data?.products?.pageInfo?.startCursor,
          productEndCursor: response?.data?.products?.pageInfo?.endCursor,
          productHasNextPage: response?.data?.products?.pageInfo?.hasNextPage,
          productHasPreviousPage:
            response?.data?.products?.pageInfo?.hasPreviousPage,
        });
      }

      return json({
        menuData: [],
        imageData: [],
        productStartCursor: "",
        productEndCursor: "",
        productHasNextPage: "",
        productHasPreviousPage: "",
      });
    } catch (error) {
      logManageTranslationGraphQLErrorDetail(
        "Error action productStartCursor productImage",
        error,
      );
      return json({
        menuData: [],
        imageData: [],
        productStartCursor: "",
        productEndCursor: "",
        productHasNextPage: "",
        productHasPreviousPage: "",
      });
    }
  }

  if (productEndCursor) {
    try {
      const loadData = await admin.graphql(
        `query {
            products(first: 20, after: "${productEndCursor?.productsEndCursor}", reverse: true) {
              edges {
                node {    
                  id
                  title
                  images(first: 20) {
                    edges {
                      node {
                        id    
                        url
                        altText
                      }
                    }
                    pageInfo {
                      hasNextPage
                      hasPreviousPage
                      startCursor
                      endCursor
                    }
                  }
                }
              } 
              pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
              }
            }
          }`,
      );
      const response = await loadData.json();
      console.log("productEndCursor", response?.data?.products?.edges);
      if (response?.data?.products?.edges.length > 0) {
        const menuData = response?.data?.products?.edges.map((item: any) => {
          return {
            key: item?.node?.id,
            label: item?.node?.title,
          };
        });
        const imageData = response?.data?.products?.edges.map((item: any) => {
          return item?.node?.images?.edges.map((image: any) => {
            return {
              key: image?.node?.id,
              productId: item?.node?.id,
              productTitle: item?.node?.title,
              imageUrl: image?.node?.url,
              imageId: image?.node?.id,
              altText: image?.node?.altText,
              targetAltText: "",
              imageStartCursor: item?.node?.images?.pageInfo?.startCursor,
              imageEndCursor: item?.node?.images?.pageInfo?.endCursor,
              imageHasNextPage: item?.node?.images?.pageInfo?.hasNextPage,
              imageHasPreviousPage:
                item?.node?.images?.pageInfo?.hasPreviousPage,
            };
          });
        });
        return json({
          menuData,
          imageData,
          productStartCursor: response?.data?.products?.pageInfo?.startCursor,
          productEndCursor: response?.data?.products?.pageInfo?.endCursor,
          productHasNextPage: response?.data?.products?.pageInfo?.hasNextPage,
          productHasPreviousPage:
            response?.data?.products?.pageInfo?.hasPreviousPage,
        });
      }

      return json({
        menuData: [],
        imageData: [],
        productStartCursor: "",
        productEndCursor: "",
        productHasNextPage: "",
        productHasPreviousPage: "",
      });
    } catch (error) {
      logManageTranslationGraphQLErrorDetail(
        "Error action productStartCursor productImage",
        error,
      );
      return json({
        menuData: [],
        imageData: [],
        productStartCursor: "",
        productEndCursor: "",
        productHasNextPage: "",
        productHasPreviousPage: "",
      });
    }
  }

  if (imageStartCursor) {
    try {
      const loadData = await admin.graphql(
        `query {
          product(id: "${imageStartCursor?.productId}") {
            id
            title
            images(last: 20, before: "${imageStartCursor?.imageStartCursor}") {
              edges {
                node {
                  id
                  url
                  altText
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
              }
            }
          }
        }`,
      );
      const response = await loadData.json();
      console.log("imageStartCursor", response?.data?.product?.images?.edges);
      if (response?.data?.product?.images?.edges.length > 0) {
        const imageData = response?.data?.product?.images?.edges.map(
          (item: any) => {
            return {
              key: item?.node?.id,
              productId: response?.data?.product?.id,
              productTitle: response?.data?.product?.title,
              imageId: item?.node?.id,
              imageUrl: item?.node?.url,
              altText: item?.node?.altText,
              targetAltText: "",
              imageStartCursor:
                response?.data?.product?.images?.pageInfo?.startCursor,
              imageEndCursor:
                response?.data?.product?.images?.pageInfo?.endCursor,
              imageHasNextPage:
                response?.data?.product?.images?.pageInfo?.hasNextPage,
              imageHasPreviousPage:
                response?.data?.product?.images?.pageInfo?.hasPreviousPage,
            };
          },
        );
        return json({
          imageData,
        });
      }

      return json({
        imageData: [],
      });
    } catch (error) {
      logManageTranslationGraphQLErrorDetail(
        "Error action imageStartCursor productImage",
        error,
      );
      return json({
        imageData: [],
      });
    }
  }

  if (imageEndCursor) {
    try {
      const loadData = await admin.graphql(
        `query {
          product(id: "${imageEndCursor?.productId}") {
            id    
            title
            images(first: 20, after: "${imageEndCursor?.imageEndCursor}") {
              edges {
                node {
                  id
                  url
                  altText
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
                startCursor
                endCursor
              }
            }
          }
        }`,
      );
      const response = await loadData.json();
      console.log("imageEndCursor", response?.data?.product?.images?.edges);
      if (response?.data?.product?.images?.edges.length > 0) {
        const imageData = response?.data?.product?.images?.edges.map(
          (item: any) => {
            return {
              key: item?.node?.id,
              productId: response?.data?.product?.id,
              productTitle: response?.data?.product?.title,
              imageId: item?.node?.id,
              imageUrl: item?.node?.url,
              altText: item?.node?.altText,
              targetAltText: "",
              imageStartCursor:
                response?.data?.product?.images?.pageInfo?.startCursor,
              imageEndCursor:
                response?.data?.product?.images?.pageInfo?.endCursor,
              imageHasNextPage:
                response?.data?.product?.images?.pageInfo?.hasNextPage,
              imageHasPreviousPage:
                response?.data?.product?.images?.pageInfo?.hasPreviousPage,
            };
          },
        );
        return json({
          imageData,
        });
      }

      return json({
        imageData: [],
      });
    } catch (error) {
      logManageTranslationGraphQLErrorDetail(
        "Error action imageEndCursor productImage",
        error,
      );
      return json({
        imageData: [],
      });
    }
  }

  return null;
};

const Index = () => {
  const { t } = useTranslation();
  const { handleSingleTranslateFailure, quotaGateModal } = useSingleTranslateQuotaGate();
  const navigate = useNavigate();
  const { reportClick } = useReport();
  const languageTableData = useSelector(
    (state: any) => state.languageTableData.rows,
  );

  const { searchTerm } = useLoaderData<typeof loader>();

  const isManualChangeRef = useRef(false);
  const loadingItemsRef = useRef<string[]>([]);

  const fetcher = useFetcher<any>();
  const loadFetcher = useFetcher<any>();
  const productsFetcher = useFetcher<any>();
  const imageFetcher = useFetcher<any>();

  const [isLoading, setIsLoading] = useState(true);
  const [saveLoading, setSaveLoading] = useState<boolean>(false);
  const [tableDataLoading, setTableDataLoading] = useState(false);
  const [menuData, setMenuData] = useState<any>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [dataResource, setDataResource] = useState<any>([]);
  const [productAltTextData, setProductAltTextData] = useState<
    {
      key: string;
      productTitle: string;
      imageUrl: string;
      altText: string;
      targetAltText: string;
      imageHasNextPage: boolean;
      imageHasPreviousPage: boolean;
      imageStartCursor: string;
      imageEndCursor: string;
    }[]
  >([
    {
      key: "",
      productTitle: "",
      imageUrl: "",
      altText: "",
      targetAltText: "",
      imageHasNextPage: false,
      imageHasPreviousPage: false,
      imageStartCursor: "",
      imageEndCursor: "",
    },
  ]);
  const [productsHasNextPage, setProductsHasNextPage] = useState(false);
  const [productsHasPreviousPage, setProductsHasPreviousPage] = useState(false);
  const [productsStartCursor, setProductsStartCursor] = useState("");
  const [productsEndCursor, setProductsEndCursor] = useState("");
  const [imageHasPreviousPage, setImageHasPreviousPage] = useState(false);
  const [imageHasNextPage, setImageHasNextPage] = useState(false);
  const [imageStartCursor, setImageStartCursor] = useState("");
  const [imageEndCursor, setImageEndCursor] = useState("");
  const [confirmData, setConfirmData] = useState<any>([]);
  const [isMobile, setIsMobile] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    searchTerm || "",
  );
  const [selectedItem, setSelectedItem] = useState<string>("productImageAlt");
  const [loadingItems, setLoadingItems] = useState<string[]>([]);
  const [successTranslatedKey, setSuccessTranslatedKey] = useState<string[]>(
    [],
  );
  const [languageOptions, setLanguageOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const itemOptions = getItemOptions(t);

  useEffect(() => {
    loadFetcher.submit({ loading: true }, { method: "post" });
    fetcher.submit(
      {
        log: `${globalStore?.shop} 目前在翻译管�?产品图片Alt图片描述页面`,
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
    if (loadFetcher.data) {
      setMenuData(loadFetcher.data.menuData);
      setDataResource(loadFetcher.data.imageData);
      setSelectedKey(loadFetcher.data.menuData[0]?.key || "");
      setProductsHasNextPage(loadFetcher.data.productHasNextPage);
      setProductsHasPreviousPage(loadFetcher.data.productHasPreviousPage);
      setProductsStartCursor(loadFetcher.data.productStartCursor);
      setProductsEndCursor(loadFetcher.data.productEndCursor);
      setTableDataLoading(false);
      setIsLoading(false);
    }
  }, [loadFetcher.data]);

  useEffect(() => {
    if (productsFetcher.data) {
      setMenuData(productsFetcher.data.menuData);
      setDataResource(productsFetcher.data.imageData);
      setSelectedKey(productsFetcher.data.menuData[0]?.key || "");
      setProductsHasNextPage(productsFetcher.data.productHasNextPage);
      setProductsHasPreviousPage(productsFetcher.data.productHasPreviousPage);
      setProductsStartCursor(productsFetcher.data.productStartCursor);
      setProductsEndCursor(productsFetcher.data.productEndCursor);
    }
  }, [productsFetcher.data]);

  useEffect(() => {
    if (imageFetcher.data) {
      setProductAltTextData(imageFetcher.data.imageData);
    }
  }, [imageFetcher.data]);

  // 更新 loadingItemsRef 的�?
  useEffect(() => {
    loadingItemsRef.current = loadingItems;
  }, [loadingItems]);

  useEffect(() => {
    if (selectedKey && dataResource.length > 0) {
      const data =
        dataResource.filter(
          (item: any) => item[0]?.productId === selectedKey,
        )[0] || [];
      async function getTargetData() {
        const targetData = await GetProductImageData({
          shopName: globalStore?.shop || "",
          productId: selectedKey,
          languageCode: selectedLanguage,
        });
        if (targetData?.success && targetData?.response?.length > 0) {
          setProductAltTextData(
            data.map((item: any) => {
              const index = targetData.response.findIndex((image: any) =>
                sameShopifyImageUrl(item.imageUrl, image.imageBeforeUrl),
              );
              if (index !== -1) {
                return {
                  ...item,
                  imageUrl:
                    targetData.response[index].imageAfterUrl || item.imageUrl,
                  targetAltText: targetData.response[index].altAfterTranslation,
                };
              }
              return item;
            }),
          );
        } else {
          setProductAltTextData(data);
        }
      }
      getTargetData();
      setConfirmData([]);
      setSuccessTranslatedKey([]);
      setIsLoading(false);
    }
  }, [selectedKey, dataResource, selectedLanguage]);

  useEffect(() => {
    setImageHasNextPage(productAltTextData[0]?.imageHasNextPage);
    setImageHasPreviousPage(productAltTextData[0]?.imageHasPreviousPage);
    setImageStartCursor(productAltTextData[0]?.imageStartCursor);
    setImageEndCursor(productAltTextData[0]?.imageEndCursor);
  }, [productAltTextData]);

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

  useContextualSaveBar("save-bar", confirmData.length > 0);

  const getTranslatedAltValue = (record: any) =>
    confirmData.find((item: any) => item.key === record?.imageId)?.value ??
    record?.targetAltText;

  const renderTranslateAction = (record: any) => {
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
        existingTranslation={getTranslatedAltValue(record)}
        sourceText={record?.altText ?? ""}
        targetLocale={searchTerm || ""}
        fieldKey={record?.shopifyKey || record?.key || "alt"}
        onSubmit={({ customPrompt, aiModel }) => {
          handleTranslate({
            resourceType: "PRODUCT_OPTION_VALUE",
            record,
            handleInputChange,
            customPrompt,
            aiModel,
          });
          reportClick("editor_list_translate");
        }}
      />
    );
  };

  const renderImageAltField = (record: any, stacked = false) => {
    if (!record) return null;

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <Image
            src={record?.imageUrl}
            preview={false}
            width={56}
            height={56}
            style={{
              objectFit: "cover",
              borderRadius: 8,
              flexShrink: 0,
            }}
          />
          <Text
            style={{
              fontSize: 13,
              fontWeight: 600,
              lineHeight: "20px",
              color: "var(--p-color-text)",
            }}
          >
            {record?.productTitle}
          </Text>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: stacked
              ? "minmax(0, 1fr)"
              : "repeat(2, minmax(0, 1fr))",
            gap: stacked ? "12px" : "12px 16px",
            alignItems: "start",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 0,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", minHeight: 24 }}>
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  lineHeight: "18px",
                  color: "var(--p-color-text-secondary)",
                }}
              >
                {t("Default Language")}
              </Text>
            </div>
            <Input disabled value={record?.altText} />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              minWidth: 0,
              position: "relative",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                minHeight: 24,
                paddingRight: 96,
              }}
            >
              <Text
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  lineHeight: "18px",
                  color: "var(--p-color-text-secondary)",
                }}
              >
                {t("Translated")}
              </Text>
            </div>
            <div
              style={{
                position: "absolute",
                top: 1,
                right: 0,
              }}
            >
              {renderTranslateAction(record)}
            </div>
            <Input
              className={
                successTranslatedKey?.includes(record?.key)
                  ? styles.success_input
                  : ""
              }
              value={getTranslatedAltValue(record)}
              onChange={(e) => handleInputChange(record, e.target.value)}
            />
          </div>
        </div>
      </div>
    );
  };

  const columns = [
    {
      title: t("Resource"),
      render: (_: any, record: any) => renderImageAltField(record),
    },
  ];

  const handleInputChange = (record: any, value: string) => {
    setConfirmData((prevData: any) => {
      const existingItemIndex = prevData.findIndex(
        (item: any) => item.key === record?.imageId,
      );
      if (existingItemIndex !== -1) {
        const updatedConfirmData = [...prevData];
        updatedConfirmData[existingItemIndex] = {
          ...updatedConfirmData[existingItemIndex],
          value: value,
        };
        return updatedConfirmData;
      } else {
        return [
          ...prevData,
          {
            key: record?.imageId,
            productId: record?.productId,
            imageUrl: record?.imageUrl,
            altText: record?.altText,
            value,
          },
        ];
      }
    });
  };

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
    if (!record?.key || !record?.altText) {
      shopify.toast.show(
        t("The source text is empty and cannot be translated"),
      );
      return;
    }
    fetcher.submit(
      {
        log: `${globalStore?.shop} 从翻译管�?产品图片Alt页面点击单行翻译`,
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
      context: record?.altText,
      key: record?.key,
      type: "SINGLE_LINE_TEXT_FIELD",
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
            log: `${globalStore?.shop} 从翻译管�?产品图片Alt页面点击单行翻译返回结果 ${data?.response}`,
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

  const handleMenuChange = (key: string) => {
    runAfterSaveBarLeave(() => {
      setSelectedKey(key);
    });
  };

  const handleLanguageChange = (language: string) => {
    runAfterSaveBarLeave(() => {
      setIsLoading(true);
      isManualChangeRef.current = true;
      setSelectedLanguage(language);
      navigate(`/app/manage_translation/productImageAlt?language=${language}`);
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

  const handleProductPrevious = () => {
    runAfterSaveBarLeave(() => {
      productsFetcher.submit(
        {
          productStartCursor: JSON.stringify({
            productsStartCursor,
          }),
        },
        {
          method: "post",
        },
      ); // 提交表单请求
    });
  };

  const handleProductNext = () => {
    runAfterSaveBarLeave(() => {
      productsFetcher.submit(
        {
          productEndCursor: JSON.stringify({
            productsEndCursor,
          }),
        },
        {
          method: "post",
        },
      ); // 提交表单请求
    });
  };

  const handleImagePrevious = () => {
    runAfterSaveBarLeave(() => {
      imageFetcher.submit(
        {
          imageStartCursor: JSON.stringify({
            imageStartCursor,
            productId: selectedKey,
          }),
        },
        {
          method: "post",
        },
      );
    });
  };

  const handleImageNext = () => {
    runAfterSaveBarLeave(() => {
      imageFetcher.submit(
        {
          imageEndCursor: JSON.stringify({
            imageEndCursor,
            productId: selectedKey,
          }),
        },
        {
          method: "post",
        },
      );
    });
  };

  const handleConfirm = async () => {
    setSaveLoading(true);
    const promises = confirmData.map((item: any) =>
      UpdateProductImageAltData({
        shopName: globalStore?.shop || "",
        productId: item.productId,
        imageUrl: item.imageUrl,
        altText: item.altText,
        targetAltText: item.value,
        languageCode: selectedLanguage,
      }),
    );

    // 并发执行所有请�?
    try {
      let successCount = 0;
      const results = await Promise.all(promises);
      // 这里可以根据 results 做成�?失败的提�?
      results.forEach((result) => {
        if (result.success) {
          successCount++;
        }
      });
      if (successCount === confirmData.length) {
        shopify.toast.show(t("Saved successfully"));
      } else {
        shopify.toast.show(t("Some items saved failed"));
      }
    } catch (error) {
      shopify.toast.show(t("Some items saved failed"));
    } finally {
      setProductAltTextData(
        productAltTextData.map((item: any) => {
          return {
            ...item,
            targetAltText: confirmData.find(
              (confirmItem: any) => item.key === confirmItem.key,
            )?.value,
          };
        }),
      );
      setConfirmData([]);
      setSuccessTranslatedKey([]);
      setSaveLoading(false);
    }
  };

  const handleDiscard = () => {
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
      title={t("Product image alt text")}
      fullWidth={true}
      backAction={{
        onAction: onCancel,
      }}
    >
      <SaveBar id="save-bar">
        <button
          variant="primary"
          onClick={handleConfirm}
          disabled={saveLoading}
        >
          {t("Save")}
        </button>
        <button onClick={handleDiscard}>{t("Discard")}</button>
      </SaveBar>
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
        ) : (
          <>
            {!isMobile && (
              <Sider
                style={{
                  height: "100%",
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
                    items={menuData}
                    selectedKeys={selectedKey}
                    onClick={handleMenuChange}
                  />
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {(productsHasPreviousPage || productsHasNextPage) && (
                      <Pagination
                        hasPrevious={productsHasPreviousPage}
                        onPrevious={handleProductPrevious}
                        hasNext={productsHasNextPage}
                        onNext={handleProductNext}
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
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
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
                        menuData!.find((item: any) => item.key === selectedKey)
                          ?.label
                      }
                    </Title>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        flexGrow: 2,
                        justifyContent: "flex-end",
                      }}
                    >
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
                  </div>
                  <Card title={t("Resource")}>
                    <Space direction="vertical" style={{ width: "100%" }}>
                      {productAltTextData.map(
                        (productAltTextItem: any, index: number) => {
                          return (
                            <Space
                              key={productAltTextItem?.imageId || index}
                              direction="vertical"
                              size="small"
                              style={{ width: "100%" }}
                            >
                              {renderImageAltField(productAltTextItem, true)}
                              <Divider
                                style={{
                                  margin: "8px 0",
                                }}
                              />
                            </Space>
                          );
                        },
                      )}
                    </Space>
                  </Card>
                  <SideMenu
                    items={menuData}
                    selectedKeys={selectedKey}
                    onClick={handleMenuChange}
                  />
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {(productsHasPreviousPage || productsHasNextPage) && (
                      <Pagination
                        hasPrevious={productsHasPreviousPage}
                        onPrevious={handleProductPrevious}
                        hasNext={productsHasNextPage}
                        onNext={handleProductNext}
                      />
                    )}
                  </div>
                </Space>
              ) : (
                <Space
                  direction="vertical"
                  size="large"
                  style={{ width: "100%" }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
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
                        menuData!.find((item: any) => item.key === selectedKey)
                          ?.label
                      }
                    </Title>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        flexGrow: 2,
                        justifyContent: "flex-end",
                      }}
                    >
                      <div
                        style={{
                          width: "150px",
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
                          width: "150px",
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
                  </div>
                  <Table
                    columns={columns}
                    dataSource={productAltTextData}
                    pagination={false}
                    loading={tableDataLoading}
                  />
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {(imageHasPreviousPage || imageHasNextPage) && (
                      <Pagination
                        hasPrevious={imageHasPreviousPage}
                        onPrevious={handleImagePrevious}
                        hasNext={imageHasNextPage}
                        onNext={handleImageNext}
                      />
                    )}
                  </div>
                </Space>
              )}
            </Content>
          </>
        )}
      </Layout>
      {quotaGateModal}
    </Page>
  );
};

export default Index;
