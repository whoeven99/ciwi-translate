import {
  Image,
  Layout,
  Result,
  Space,
  Spin,
  Table,
  Upload,
  Typography,
  Menu,
  Card,
  Divider,
  Modal,
  Input,
} from "antd";
import Button from "~/ui/components/AppButton";
import { SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { ActionFunctionArgs, json } from "@remix-run/node";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { NoteIcon } from "@shopify/polaris-icons";
import { Page, Pagination, Thumbnail, Spinner } from "@shopify/polaris";
import { InFlowSelect as Select } from "~/ui/components/InFlowSelect";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { authenticate } from "~/shopify.server";
import {
  DeleteProductImageData,
  GetProductImageData,
  UploadProductImage,
} from "~/api/pictureClient";
import { sameShopifyImageUrl } from "~/utils/shopifyImageUrl";
import { globalStore } from "~/globalStore";
import { getItemOptions } from "../app.manage_translation/route";
import {
  manageTranslationLanguageLoader,
} from "~/server/manageTranslation/manageTranslationRoute.server";
import { logManageTranslationGraphQLErrorDetail } from "~/utils/manageTranslationErrors";

const { Sider, Content } = Layout;
const { Title, Text } = Typography;

export const loader = manageTranslationLanguageLoader;

export const action = async ({ request }: ActionFunctionArgs) => {
  const adminAuthResult = await authenticate.admin(request);
  const { admin } = adminAuthResult;

  const formData = await request.formData();
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

  if (productStartCursor) {
    try {
      const data = await admin.graphql(
        `#graphql
          query products($startCursor: String, $query: String) {     
            products(last: 20 ,before: $startCursor, query: $query, reverse: true) {
              edges {
              node {
                id
                title
                images(first: 20) {
                  edges {
                    node {
                      id
                      url 
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
        {
          variables: {
            startCursor: productStartCursor?.cursor
              ? productStartCursor?.cursor
              : undefined,
            query: productStartCursor?.query,
          },
        },
      );

      const response = await data.json();

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
              imageId: image?.node?.id,
              imageUrl: image?.node?.url,
              targetImageUrl: "",
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
      const data = await admin.graphql(
        `#graphql
          query products($endCursor: String, $query: String) {     
            products(first: 20 ,after: $endCursor, query: $query, reverse: true) {
              edges {
              node {
                id
                title
                images(first: 20) {
                  edges {
                    node {
                      id
                      url 
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
        {
          variables: {
            endCursor: productEndCursor?.cursor
              ? productEndCursor?.cursor
              : undefined,
            query: productEndCursor?.query,
          },
        },
      );

      const response = await data.json();

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
              imageId: image?.node?.id,
              imageUrl: image?.node?.url,
              targetImageUrl: "",
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
        "Error action productEndCursor productImage",
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
              targetImageUrl: "",
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

      console.log("imageEndCursor", response?.data?.product?.images);
      if (response?.data?.product?.images?.edges.length > 0) {
        const imageData = response?.data?.product?.images?.edges.map(
          (item: any) => {
            return {
              key: item?.node?.id,
              productId: response?.data?.product?.id,
              productTitle: response?.data?.product?.title,
              imageId: item?.node?.id,
              imageUrl: item?.node?.url,
              targetImageUrl: "",
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
  const { searchTerm } = useLoaderData<typeof loader>();

  const { t } = useTranslation();
  const navigate = useNavigate();
  const isManualChange = useRef(true);
  const timeoutIdRef = useRef<any>(true);

  const languageTableData = useSelector(
    (state: any) => state.languageTableData.rows,
  );

  const { source } = useSelector((state: any) => state.userConfig);

  const fetcher = useFetcher<any>();
  const productsFetcher = useFetcher<any>();
  const imageFetcher = useFetcher<any>();
  const translateImageFetcher = useFetcher<any>();
  const replaceTranslateImageFetcher = useFetcher<any>();
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);
  const [menuData, setMenuData] = useState<any>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [dataResource, setDataResource] = useState<any>([]);
  const [productImageData, setProductImageData] = useState<
    {
      key: string;
      productTitle: string;
      imageUrl: string;
      targetImageUrl: string;
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
      targetImageUrl: "",
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
  const [isMobile, setIsMobile] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    searchTerm || "",
  );
  const [selectedItem, setSelectedItem] = useState<string>("productImage");
  const [languageOptions, setLanguageOptions] = useState<
    { label: string; value: string }[]
  >([]);
  const [queryText, setQueryText] = useState<string>("");
  const itemOptions = getItemOptions(t);

  const [translatrImageactive, setTranslatrImageactive] = useState(false);
  const [sourceLanguages, setSourceLanguages] = useState<any[]>([]);
  const [targetLanguages, setTargetLanguages] = useState<any[]>();
  const [currentTranslatingImage, serCurrentTranslatingImage] =
    useState<any>("");
  const baseInput = new Set([
    "zh",
    "zh-tw",
    "en",
    "fr",
    "it",
    "ja",
    "ko",
    "pt",
    "ru",
    "es",
    "th",
    "tr",
    "vi",
  ]);
  const baseOutput = new Set([
    "ar",
    "bn",
    "zh",
    "zh-tw",
    "cs",
    "da",
    "nl",
    "en",
    "fi",
    "fr",
    "de",
    "el",
    "he",
    "hu",
    "id",
    "it",
    "ja",
    "kk",
    "ko",
    "ms",
    "pl",
    "pt",
    "ru",
    "es",
    "sv",
    "th",
    "tl",
    "tr",
    "uk",
    "ur",
    "vi",
  ]);
  const allLanguageOptions = [
    { label: "Arabic", value: "ar" },
    { label: "Bengali", value: "bn" },
    { label: "Chinese (Simplified)", value: "zh" },
    { label: "Chinese (Traditional)", value: "zh-tw" },
    { label: "Czech", value: "cs" },
    { label: "Danish", value: "da" },
    { label: "Dutch", value: "nl" },
    { label: "English", value: "en" },
    { label: "Finnish", value: "fi" },
    { label: "French", value: "fr" },
    { label: "German", value: "de" },
    { label: "Greek", value: "el" },
    { label: "Hebrew", value: "he" },
    { label: "Hungarian", value: "hu" },
    { label: "Indonesian", value: "id" },
    { label: "Italian", value: "it" },
    { label: "Japanese", value: "ja" },
    { label: "Kazakh", value: "kk" },
    { label: "Korean", value: "ko" },
    { label: "Malay", value: "ms" },
    { label: "Polish", value: "pl" },
    { label: "Portuguese", value: "pt" },
    { label: "Russian", value: "ru" },
    { label: "Spanish", value: "es" },
    { label: "Swedish", value: "sv" },
    { label: "Thai", value: "th" },
    { label: "Tagalog (Filipino)", value: "tl" },
    { label: "Turkish", value: "tr" },
    { label: "Ukrainian", value: "uk" },
    { label: "Urdu", value: "ur" },
    { label: "Vietnamese", value: "vi" },
  ];
  const [sourceLanguage, setSourceLanguage] = useState("");
  const [targetLanguage, setTargetLanguage] = useState(selectedLanguage);
  const specialTargetRules: Record<string, string[]> = {
    "zh-tw": ["zh", "en"], // 目标为繁体，只能�?zh �?en 来翻�?
    el: ["en", "tr"], // 目标为希腊语，只能由 en �?tr 来翻�?
    kk: ["zh"], // 目标为哈萨克语，只能�?zh 来翻�?
  };

  useEffect(() => {
    // 初始化源语言下拉
    const sourceLangOptions = [...baseInput].map((lang) => {
      return {
        label: allLanguageOptions.find((o) => o.value === lang)?.label ?? lang,
        value: lang,
      };
    });
    setSourceLanguages(sourceLangOptions);
  }, []);

  useEffect(() => {
    if (source?.code) {
      setSourceLanguage(normalizeLocale(source?.code));
    }
  }, [source]);

  const canTranslate = (source: string, target: string): boolean => {
    const src = normalizeLocale(source);
    const tgt = normalizeLocale(target);
    // 目标语言必须在输出范�?
    if (!baseOutput.has(tgt)) return false;
    // 源语言必须在输入范�?
    if (!baseInput.has(src)) return false;
    // 检查是否有特殊规则
    if (specialTargetRules[tgt]) {
      return specialTargetRules[tgt].includes(src);
    }
    return true;
  };
  const normalizeLocale = (locale: string): string => {
    if (!locale) return "";
    const lower = locale.toLowerCase();

    if (lower.startsWith("zh-cn")) return "zh";
    if (lower.startsWith("zh-tw")) return "zh-tw";
    if (lower.startsWith("en")) return "en";
    if (lower.startsWith("pt")) return "pt";

    // �?处理其它常见格式（如 en-US / fr-CA�?
    return lower;
  };
  useEffect(() => {
    setTargetLanguage(normalizeLocale(selectedLanguage));
  }, [selectedLanguage]);
  // �?sourceLanguage 改变时，动态计�?targetLanguages
  useEffect(() => {
    const allowedTargets = [...baseOutput].filter((target) => {
      // 排除�?source 相同�?code（避免自翻译�?
      if (target === normalizeLocale(sourceLanguage)) return false;

      // 如果目标在特殊规则里，则仅当当前 source 在允许列表中才允许该目标
      if (specialTargetRules[target]) {
        return specialTargetRules[target]?.includes(
          normalizeLocale(sourceLanguage),
        );
      }
      // 否则默认允许
      return true;
    });

    const options = allowedTargets.map((v) => {
      const label = allLanguageOptions.find((o) => o.value === v)?.label ?? v;
      return { label: label, value: v };
    });

    setTargetLanguages(options);

    // 如果当前选的 targetLanguage 不在新候选里，重置为第一个（如果存在�?
    if (!allowedTargets.includes(targetLanguage)) {
      setTargetLanguage(options[0]?.value ?? "");
    }
  }, [sourceLanguage]);
  const buildOptions = (langs: string[]) =>
    langs.map((v) => {
      const label = allLanguageOptions.find((o) => o.value === v)?.label ?? v;
      return { label, value: v };
    });
  useEffect(() => {
    if (targetLanguage && specialTargetRules[targetLanguage]) {
      const allowedSources = specialTargetRules[targetLanguage];
      setSourceLanguages(buildOptions(allowedSources)); // 🎯 转换�?{label, value} 格式
    } else {
      setSourceLanguages(buildOptions([...baseInput])); // 🎯 同样格式
    }
  }, [targetLanguage]);
  // 图片翻译
  const handleTranslate = async () => {
    translateImageFetcher.submit(
      {
        translateImage: JSON.stringify({
          sourceLanguage,
          targetLanguage,
          imageUrl: currentTranslatingImage.imageUrl,
          imageId: currentTranslatingImage?.productId,
        }),
      },
      { method: "post", action: "/app/manage_translation" },
    );
    setTranslatrImageactive(false);
  };

  const onClose = () => {
    setTranslatrImageactive(false);
  };

  const handleImageTranslate = (record: any) => {
    // 语言限制弹框
    if (!canTranslate(sourceLanguage, targetLanguage)) {
      // console.log("当前语言不支持翻�?);
      shopify.toast.show(
        t("The current language does not support image translation"),
      );
      return;
    }
    setTranslatrImageactive(true);
    serCurrentTranslatingImage(record);
  };

  useEffect(() => {
    if (translateImageFetcher.data) {
      if (translateImageFetcher.data.success) {
        shopify.toast.show(t("Image translated successfully"));
        setProductImageData((prev: any[]) =>
          prev.map((item: any) => {
            if (item.imageUrl === currentTranslatingImage.imageUrl) {
              return {
                ...item,
                targetImageUrl: translateImageFetcher.data.response,
              };
            }
            return item;
          }),
        );
        const replaceTranslateImage = {
          url: translateImageFetcher.data.response,
          userPicturesDoJson: {
            imageId: currentTranslatingImage?.productId,
            imageBeforeUrl: currentTranslatingImage?.imageUrl,
            altBeforeTranslation: "",
            altAfterTranslation: "",
            languageCode: selectedLanguage,
          },
        };
        const formData = new FormData();
        formData.append(
          "replaceTranslateImage",
          JSON.stringify(replaceTranslateImage),
        );
        replaceTranslateImageFetcher.submit(formData, {
          method: "post",
          action: "/app/manage_translation",
        });
      } else {
        shopify.toast.show(t("Image translation failed"));
      }
    }
  }, [translateImageFetcher.data]);

  useEffect(() => {
    if (!replaceTranslateImageFetcher.data) return;
    if (!replaceTranslateImageFetcher.data.success) {
      shopify.toast.show(t("Image translation saved failed"));
      console.error(
        "replaceTranslateImage failed",
        replaceTranslateImageFetcher.data,
      );
    }
  }, [replaceTranslateImageFetcher.data, t]);

  useEffect(() => {
    productsFetcher.submit(
      {
        productEndCursor: JSON.stringify({
          cursor: productsEndCursor,
          query: queryText,
        }),
      },
      { method: "post" },
    );
    fetcher.submit(
      {
        log: `${globalStore?.shop} 目前在翻译管�?产品图片页面`,
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
      setProductImageData(imageFetcher.data.imageData);
    }
  }, [imageFetcher.data]);

  useEffect(() => {
    if (selectedKey && dataResource.length > 0) {
      const data =
        dataResource.filter(
          (item: any) => item[0]?.productId === selectedKey,
        )[0] || [];
      const getTargetData = async () => {
        const targetData = await GetProductImageData({
          shopName: globalStore?.shop || "",
          productId: selectedKey,
          languageCode: selectedLanguage,
        });
        if (targetData?.success && targetData?.response?.length > 0) {
          setProductImageData(
            data.map((item: any) => {
              const index = targetData.response.findIndex((image: any) =>
                sameShopifyImageUrl(item.imageUrl, image?.imageBeforeUrl),
              );
              if (index !== -1) {
                return {
                  ...item,
                  targetImageUrl: targetData.response[index]?.imageAfterUrl,
                };
              }
              return item;
            }),
          );
        } else {
          setProductImageData(data);
        }
      };
      getTargetData();
      setIsLoading(false);
    }
  }, [selectedKey, dataResource, selectedLanguage]);

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

  const columns = [
    {
      title: t("Products"),
      key: "productTitle",
      width: "10%",
      render: (_: any, record: any) => {
        return (
          <div>
            {record?.imageUrl.split("/files/")[2] || record?.productTitle}
          </div>
        );
      },
    },
    {
      title: t("Default image"),
      key: "imageUrl",
      width: "40%",
      render: (_: any, record: any) => {
        return (
          <Image
            src={record?.imageUrl}
            preview={false}
            width={"50%"}
            height={"auto"}
          />
        );
      },
    },
    {
      title: t("Translated image"),
      key: "targetImageUrl",
      width: "40%",
      render: (_: any, record: any) => {
        return record?.targetImageUrl ? (
          <Image
            src={record?.targetImageUrl}
            preview={false}
            width={"50%"}
            height={"auto"}
          />
        ) : (
          <>
            {record.imageId === currentTranslatingImage.imageId &&
            translateImageFetcher.state === "submitting" ? (
              <Spinner accessibilityLabel="Loading thumbnail" size="large" />
            ) : (
              <Thumbnail source={NoteIcon} size="large" alt="Small document" />
            )}
          </>
        );
      },
    },
    {
      title: t("Action"),
      key: "translate",
      width: "10%",
      render: (_: any, record: any) => {
        return (
          <Space direction="vertical">
            <Button
              loading={
                record.imageId === currentTranslatingImage.imageId &&
                translateImageFetcher.state === "submitting"
              }
              onClick={() => handleImageTranslate(record)}
            >
              {t("Translate")}
            </Button>
            <Upload
              disabled={translateImageFetcher.state === "submitting"}
              pastable={false}
              maxCount={1}
              accept="image/*"
              name="file"
              customRequest={async ({ file, onSuccess, onError }) => {
                try {
                  const result = await UploadProductImage({
                    shopName: globalStore?.shop ?? "",
                    productId: record?.productId,
                    imageUrl: record?.imageUrl,
                    languageCode: selectedLanguage,
                    file: file as Blob,
                  });
                  if (!result?.success) {
                    onError?.(new Error(result?.errorMsg || "Upload Failed"));
                    return;
                  }
                  onSuccess?.(result);
                } catch (err) {
                  onError?.(err as Error);
                }
              }}
              beforeUpload={(file) => {
                const isImage = file.type.startsWith("image/");
                const isLt20M = file.size / 1024 / 1024 < 20;

                // 检查文件格�?
                const supportedFormats = [
                  "image/jpeg",
                  "image/png",
                  "image/webp",
                  "image/heic",
                  "image/gif",
                ];
                const isSupportedFormat = supportedFormats.includes(file.type);

                if (!isImage) {
                  shopify.toast.show(t("Only images can be uploaded"));
                  return false;
                }

                if (!isSupportedFormat) {
                  shopify.toast.show(
                    t(
                      "Only JPEG, PNG, WEBP, HEIC and GIF formats are supported",
                    ),
                  );
                  return false;
                }

                if (!isLt20M) {
                  shopify.toast.show(t("File must be less than 20MB"));
                  return false;
                }

                // 检查图片像素大�?
                return new Promise((resolve) => {
                  const img = new window.Image();
                  img.onload = () => {
                    const pixelCount = img.width * img.height;
                    const maxPixels = 20000000; // 2000万像�?

                    if (pixelCount > maxPixels) {
                      shopify.toast.show(
                        t("Image pixel size cannot exceed 20 million pixels"),
                      );
                      resolve(false);
                    } else {
                      resolve(true);
                    }
                  };
                  img.onerror = () => {
                    shopify.toast.show(t("Failed to read image dimensions"));
                    resolve(false);
                  };
                  img.src = URL.createObjectURL(file);
                });
              }}
              onChange={(info) => {
                if (info.file.status !== "uploading") {
                }
                if (info.file.status === "done") {
                  setProductImageData((prev: any[]) =>
                    prev.map((item: any) => {
                      if (
                        sameShopifyImageUrl(
                          item.imageUrl,
                          info.fileList[0].response.response?.imageBeforeUrl,
                        )
                      ) {
                        return {
                          ...item,
                          targetImageUrl:
                            info.fileList[0].response.response.imageAfterUrl,
                        };
                      }
                      return item;
                    }),
                  );
                  if (info.fileList[0].response?.success) {
                    shopify.toast.show(
                      `${info.file.name} ${t("Upload Success")}`,
                    );
                  } else {
                    shopify.toast.show(
                      `${info.file.name} ${t("Upload Failed")}`,
                    );
                  }
                } else if (info.file.status === "error") {
                  shopify.toast.show(`${info.file.name} ${t("Upload Failed")}`);
                }
              }}
            >
              <Button icon={<UploadOutlined />}>{t("Click to Upload")}</Button>
            </Upload>
            <Button
              disabled={!record?.targetImageUrl}
              loading={isDeleteLoading}
              onClick={() => handleDelete(record?.productId, record?.imageUrl)}
            >
              {t("Delete")}
            </Button>
          </Space>
        );
      },
    },
  ];

  const handleSearch = (value: string) => {
    setQueryText(value);

    // 清除上一次的定时�?
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
    }

    // 延迟 1s 再执行请�?
    timeoutIdRef.current = setTimeout(() => {
      productsFetcher.submit(
        {
          productEndCursor: JSON.stringify({
            cursor: "",
            query: value,
          }),
        },
        {
          method: "post",
        },
      );
    }, 500);
  };

  const handleMenuChange = (key: string) => {
    setSelectedKey(key);
  };

  const handleLanguageChange = (language: string) => {
    setIsLoading(true);
    isManualChange.current = true;
    setSelectedLanguage(language);
    navigate(`/app/manage_translation/productImage?language=${language}`);
  };

  const handleItemChange = (item: string) => {
    setIsLoading(true);
    isManualChange.current = true;
    setSelectedItem(item);
    navigate(`/app/manage_translation/${item}?language=${searchTerm}`);
  };

  const handleProductPrevious = () => {
    productsFetcher.submit(
      {
        productStartCursor: JSON.stringify({
          cursor: productsStartCursor,
          query: queryText,
        }),
      },
      {
        method: "post",
      },
    ); // 提交表单请求
  };

  const handleProductNext = () => {
    productsFetcher.submit(
      {
        productEndCursor: JSON.stringify({
          cursor: productsEndCursor,
          query: queryText,
        }),
      },
      {
        method: "post",
      },
    ); // 提交表单请求
  };

  const handleImagePrevious = () => {
    imageFetcher.submit(
      {
        imageStartCursor: JSON.stringify({
          imageStartCursor: productImageData[0]?.imageStartCursor,
          productId: selectedKey,
        }),
      },
      {
        method: "post",
      },
    );
  };

  const handleImageNext = () => {
    imageFetcher.submit(
      {
        imageEndCursor: JSON.stringify({
          imageEndCursor: productImageData[0]?.imageEndCursor,
          productId: selectedKey,
        }),
      },
      {
        method: "post",
      },
    );
  };

  const handleDelete = async (productId: string, imageUrl: string) => {
    setIsDeleteLoading(true);
    const res = await DeleteProductImageData({
      shopName: globalStore?.shop || "",
      productId: productId,
      imageUrl: imageUrl,
      languageCode: selectedLanguage,
    });

    console.log("res", res);

    if (res.success) {
      setDataResource((prev: any[]) =>
        prev.map((item: any) =>
          item.map((image: any) =>
            sameShopifyImageUrl(image.imageUrl, imageUrl)
              ? { ...image, targetImageUrl: "" }
              : image,
          ),
        ),
      );
      setProductImageData((prev: any[]) =>
        prev.map((item: any) =>
          sameShopifyImageUrl(item.imageUrl, imageUrl)
            ? { ...item, targetImageUrl: "" }
            : item,
        ),
      );
      shopify.toast.show(t("Delete Success"));
    } else {
      shopify.toast.show(t("Delete Failed"));
    }
    setIsDeleteLoading(false);
  };

  const onCancel = () => {
    navigate(`/app/manage_translation?language=${searchTerm}`); // 跳转�?/app/manage_translation
  };

  return (
    <Page
      title={t("Product images")}
      fullWidth={true}
      backAction={{
        onAction: onCancel,
      }}
    >
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
        ) : dataResource.length > 0 ? (
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
                {/* <ItemsScroll
                selectItem={selectProductKey}
                menuData={menuData}
                setSelectItem={setSelectProductKey}
              /> */}
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    flex: 1,
minHeight: 0,
justifyContent: "space-between",
                  }}
                >
                  <Menu
                    mode="inline"
                    style={{
                      flex: 1,
                      overflowY: "auto",
                      minHeight: 0,
                      backgroundColor: "var(--p-color-bg)",
                    }}
                    items={menuData}
                    selectedKeys={[selectedKey]}
                    onClick={(e: any) => handleMenuChange(e.key)}
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
                  </div>
                  <Card title={t("Resource")}>
                    <Space direction="vertical" style={{ width: "100%" }}>
                      {productImageData.map((item: any, index: number) => {
                        return (
                          <Space
                            key={item.key || item.imageId || item.imageUrl || index}
                            direction="vertical"
                            size="small"
                            style={{ width: "100%" }}
                          >
                            <Text
                              strong
                              style={{
                                fontSize: "16px",
                              }}
                            >
                              {item.productTitle}
                            </Text>
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                              }}
                            >
                              <Text>{t("Default Language")}</Text>
                              <Image
                                src={item.imageUrl}
                                preview={false}
                                width={"50%"}
                              />
                            </div>
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                              }}
                            >
                              <Text>{t("Translated")}</Text>
                              {item.targetImageUrl ? (
                                <Image
                                  src={item.targetImageUrl}
                                  preview={false}
                                  width={"50%"}
                                />
                              ) : (
                                <Upload
                                  pastable={false}
                                  maxCount={1}
                                  accept="image/*"
                                  name="file"
                                  customRequest={async ({
                                    file,
                                    onSuccess,
                                    onError,
                                  }) => {
                                    try {
                                      const result = await UploadProductImage({
                                        shopName: globalStore?.shop ?? "",
                                        productId: item?.productId,
                                        imageUrl: item?.imageUrl,
                                        languageCode: selectedLanguage,
                                        file: file as Blob,
                                      });
                                      if (!result?.success) {
                                        onError?.(
                                          new Error(
                                            result?.errorMsg || "Upload Failed",
                                          ),
                                        );
                                        return;
                                      }
                                      onSuccess?.(result);
                                    } catch (err) {
                                      onError?.(err as Error);
                                    }
                                  }}
                                  beforeUpload={(file) => {
                                    const isImage =
                                      file.type.startsWith("image/");
                                    const isLt20M =
                                      file.size / 1024 / 1024 < 20;

                                    // 检查文件格�?
                                    const supportedFormats = [
                                      "image/jpeg",
                                      "image/png",
                                      "image/webp",
                                      "image/heic",
                                      "image/gif",
                                    ];
                                    const isSupportedFormat =
                                      supportedFormats.includes(file.type);

                                    if (!isImage) {
                                      shopify.toast.show(
                                        t("Only images can be uploaded"),
                                      );
                                      return false;
                                    }

                                    if (!isSupportedFormat) {
                                      shopify.toast.show(
                                        t(
                                          "Only JPEG, PNG, WEBP, HEIC and GIF formats are supported",
                                        ),
                                      );
                                      return false;
                                    }

                                    if (!isLt20M) {
                                      shopify.toast.show(
                                        t("File must be less than 20MB"),
                                      );
                                      return false;
                                    }

                                    // 检查图片像素大�?
                                    return new Promise((resolve) => {
                                      const img = new window.Image();
                                      img.onload = () => {
                                        const pixelCount =
                                          img.width * img.height;
                                        const maxPixels = 20000000; // 2000万像�?

                                        if (pixelCount > maxPixels) {
                                          shopify.toast.show(
                                            t(
                                              "Image pixel size cannot exceed 20 million pixels",
                                            ),
                                          );
                                          resolve(false);
                                        } else {
                                          resolve(true);
                                        }
                                      };
                                      img.onerror = () => {
                                        shopify.toast.show(
                                          t("Failed to read image dimensions"),
                                        );
                                        resolve(false);
                                      };
                                      img.src = URL.createObjectURL(file);
                                    });
                                  }}
                                  onChange={(info) => {
                                    if (info.file.status !== "uploading") {
                                    }
                                    if (info.file.status === "done") {
                                      setProductImageData((prev: any[]) =>
                                        prev.map((item: any) => {
                                          if (
                                            sameShopifyImageUrl(
                                              item.imageUrl,
                                              info.fileList[0].response.response
                                                ?.imageBeforeUrl,
                                            )
                                          ) {
                                            return {
                                              ...item,
                                              targetImageUrl:
                                                info.fileList[0].response
                                                  .response.imageAfterUrl,
                                            };
                                          }
                                          return item;
                                        }),
                                      );
                                      if (info.fileList[0].response?.success) {
                                        shopify.toast.show(
                                          `${info.file.name} ${t("Upload Success")}`,
                                        );
                                      } else {
                                        shopify.toast.show(
                                          `${info.file.name} ${t("Upload Failed")}`,
                                        );
                                      }
                                    } else if (info.file.status === "error") {
                                      shopify.toast.show(
                                        `${info.file.name} ${t("Upload Failed")}`,
                                      );
                                    }
                                  }}
                                >
                                  <Button icon={<UploadOutlined />}>
                                    {t("Click to Upload")}
                                  </Button>
                                </Upload>
                              )}
                            </div>
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "flex-end",
                              }}
                            >
                              <Button
                                disabled={!item.targetImageUrl}
                                loading={isDeleteLoading}
                                onClick={() =>
                                  handleDelete(item?.productId, item?.imageUrl)
                                }
                              >
                                {t("Delete")}
                              </Button>
                            </div>
                            <Divider
                              style={{
                                margin: "8px 0",
                              }}
                            />
                          </Space>
                        );
                      })}
                    </Space>
                  </Card>
                  <Menu
                    mode="inline"
                    style={{
                      flex: 1,
                      overflowY: "auto",
                      minHeight: 0,
                    }}
                    items={menuData}
                    selectedKeys={[selectedKey]}
                    onClick={(e: any) => handleMenuChange(e.key)}
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
                  <Table
                    columns={columns}
                    dataSource={productImageData}
                    rowKey="key"
                    pagination={false}
                  />
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    {(productImageData[0]?.imageHasPreviousPage ||
                      productImageData[0]?.imageHasNextPage) && (
                      <Pagination
                        hasPrevious={productImageData[0]?.imageHasPreviousPage}
                        onPrevious={handleImagePrevious}
                        hasNext={productImageData[0]?.imageHasNextPage}
                        onNext={handleImageNext}
                      />
                    )}
                  </div>
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
        <Modal
          title={t("Image Translation")}
          open={translatrImageactive}
          onCancel={onClose}
          footer={[
            <Space
              key="manage-translation-product-image-footer"
              direction="vertical"
              style={{ textAlign: "center" }}
            >
              <Button key="translate" type="primary" onClick={handleTranslate}>
                {t("Image Translation")}
              </Button>
              <span>{t("1000 credits")}</span>
            </Space>,
          ]}
          centered
        >
          <div style={{ padding: "15px 0" }}>
            <p style={{ marginBottom: "10px" }}>{t("Source Language")}</p>
            <Select
              label={t("Source Language")}
              labelHidden
              style={{ width: "100%", marginBottom: "20px" }}
              value={sourceLanguage}
              onChange={setSourceLanguage}
              options={sourceLanguages}
            />
            <span>{t("Target Language")}</span>
            <Select
              label={t("Target Language")}
              labelHidden
              style={{ width: "100%", marginTop: "10px" }}
              value={targetLanguage}
              onChange={setTargetLanguage}
              options={targetLanguages ?? []}
            />
          </div>
        </Modal>
      </Layout>
    </Page>
  );
};

export default Index;
