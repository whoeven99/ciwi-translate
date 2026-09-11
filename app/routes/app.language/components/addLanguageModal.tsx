import { useEffect, useMemo, useRef, useState } from "react";
import {
  Input,
  Space,
  InputRef,
  Collapse,
  Checkbox,
  Spin,
  Empty,
} from "antd";
import type { CollapseProps } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { AppSModal } from "~/ui/components/AppSModal";
import SelectedTag from "../../../components/selectedTag";
import { LanguagesDataType } from "~/routes/app.language/route";
import { useDispatch, useSelector } from "react-redux";
import { updateLanguageTableData } from "~/store/modules/languageTableData";
import { useTranslation } from "react-i18next";
import { useFetcher } from "@remix-run/react";
import {
  type ClientLogTrace,
  finishClientLogTrace,
  startClientLogTrace,
} from "~/utils/clientLog";
import { useConsumableFetcherData } from "~/hooks/useConsumableFetcherData";

interface AddLanguageModalProps {
  shop: string;
  isVisible: boolean;
  setIsModalOpen: (visible: boolean) => void;
  languageLocaleData: any;
}

const AddLanguageModal: React.FC<AddLanguageModalProps> = ({
  shop,
  isVisible,
  setIsModalOpen,
  languageLocaleData,
}) => {
  const { t } = useTranslation();

  //用户默认语言数据
  const { source } = useSelector((state: any) => state.userConfig);

  const regions = [
    // 常用语言
    {
      name: t("Common_Languages"),
      countries: [
        { isoCode: "en", name: "English", flag: "🇺🇸" },
        { isoCode: "zh-CN", name: "Chinese (Simplified)", flag: "🇨🇳" },
        { isoCode: "es", name: "Spanish", flag: "🇪🇸" },
        { isoCode: "fr", name: "French", flag: "🇫🇷" },
        { isoCode: "de", name: "German", flag: "🇩🇪" },
        { isoCode: "pt-BR", name: "Portuguese (Brazil)", flag: "🇧🇷" },
        { isoCode: "pt-PT", name: "Portuguese (Portugal)", flag: "🇵🇹" },
        { isoCode: "ar", name: "Arabic", flag: "ar" },
        { isoCode: "ru", name: "Russian", flag: "🇷🇺" },
        { isoCode: "hi", name: "Hindi", flag: "🇮🇳" },
        { isoCode: "ja", name: "Japanese", flag: "🇯🇵" },
        { isoCode: "vi", name: "Vietnamese", flag: "🇻🇳" },
        { isoCode: "th", name: "Thai", flag: "🇹🇭" },
        { isoCode: "id", name: "Indonesian", flag: "🇮🇩" },
        { isoCode: "ko", name: "Korean", flag: "🇰🇷" },
        { isoCode: "tr", name: "Turkish", flag: "🇹🇷" },
        { isoCode: "pl", name: "Polish", flag: "🇵🇱" },
        { isoCode: "fil", name: "Filipino", flag: "🇵🇭" },
      ],
    },
    // 亚洲
    {
      name: t("Asia"),
      countries: [
        { isoCode: "ar", name: "Arabic", flag: "ar" },
        { isoCode: "as", name: "Assamese", flag: "🇮🇳" },
        { isoCode: "hy", name: "Armenian", flag: "🇦🇲" },
        { isoCode: "az", name: "Azerbaijani", flag: "🇦🇿" },
        { isoCode: "bn", name: "Bangla", flag: "🇧🇩" },
        { isoCode: "my", name: "Burmese", flag: "🇲🇲" },
        { isoCode: "ckb", name: "Central Kurdish", flag: "🇮🇶" },
        { isoCode: "zh-CN", name: "Chinese (Simplified)", flag: "🇨🇳" },
        { isoCode: "zh-TW", name: "Chinese (Traditional)", flag: "🇹🇼" },
        { isoCode: "dz", name: "Dzongkha", flag: "🇧🇹" },
        { isoCode: "fil", name: "Filipino", flag: "🇵🇭" },
        { isoCode: "ka", name: "Georgian", flag: "🇬🇪" },
        { isoCode: "gu", name: "Gujarati", flag: "🇮🇳" },
        { isoCode: "he", name: "Hebrew", flag: "🇮🇱" },
        { isoCode: "hi", name: "Hindi", flag: "🇮🇳" },
        { isoCode: "id", name: "Indonesian", flag: "🇮🇩" },
        { isoCode: "ja", name: "Japanese", flag: "🇯🇵" },
        { isoCode: "jv", name: "Javanese", flag: "🇮🇩" },
        { isoCode: "kn", name: "Kannada", flag: "🇮🇳" },
        { isoCode: "ks", name: "Kashmiri", flag: "🇮🇳" },
        { isoCode: "kk", name: "Kazakh", flag: "🇰🇿" },
        { isoCode: "km", name: "Khmer", flag: "🇰🇭" },
        { isoCode: "ko", name: "Korean", flag: "🇰🇷" },
        { isoCode: "ku", name: "Kurdish", flag: "🇮🇶" },
        { isoCode: "ky", name: "Kyrgyz", flag: "🇰🇬" },
        { isoCode: "lo", name: "Lao", flag: "🇱🇦" },
        { isoCode: "ml", name: "Malayalam", flag: "🇮🇳" },
        { isoCode: "mr", name: "Marathi", flag: "🇮🇳" },
        { isoCode: "mn", name: "Mongolian", flag: "🇲🇳" },
        { isoCode: "ne", name: "Nepali", flag: "🇳🇵" },
        { isoCode: "or", name: "Odia", flag: "🇮🇳" },
        { isoCode: "os", name: "Ossetic", flag: "🇷🇺" },
        { isoCode: "ps", name: "Pashto", flag: "🇦🇫" },
        { isoCode: "fa", name: "Persian", flag: "🇮🇷" },
        { isoCode: "pa", name: "Punjabi", flag: "🇮🇳" },
        { isoCode: "sa", name: "Sanskrit", flag: "🇮🇳" },
        { isoCode: "ii", name: "Sichuan Yi", flag: "🇨🇳" },
        { isoCode: "sd", name: "Sindhi", flag: "🇵🇰" },
        { isoCode: "si", name: "Sinhala", flag: "🇱🇰" },
        { isoCode: "su", name: "Sundanese", flag: "🇮🇩" },
        { isoCode: "tg", name: "Tajik", flag: "🇹🇯" },
        { isoCode: "ta", name: "Tamil", flag: "🇮🇳" },
        { isoCode: "te", name: "Telugu", flag: "🇮🇳" },
        { isoCode: "th", name: "Thai", flag: "🇹🇭" },
        { isoCode: "bo", name: "Tibetan", flag: "🇨🇳" },
        { isoCode: "tr", name: "Turkish", flag: "🇹🇷" },
        { isoCode: "tk", name: "Turkmen", flag: "🇹🇲" },
        { isoCode: "ur", name: "Urdu", flag: "🇵🇰" },
        { isoCode: "ug", name: "Uyghur", flag: "🇨🇳" },
        { isoCode: "uz", name: "Uzbek", flag: "🇺🇿" },
        { isoCode: "vi", name: "Vietnamese", flag: "🇻🇳" },
        { isoCode: "yi", name: "Yiddish", flag: "🇩🇪" },
      ],
    },

    // 欧洲
    {
      name: t("Europe"),
      countries: [
        { isoCode: "en", name: "English", flag: "🇺🇸" },
        { isoCode: "sq", name: "Albanian", flag: "🇦🇱" },
        { isoCode: "hy", name: "Armenian", flag: "🇦🇲" },
        { isoCode: "eu", name: "Basque", flag: "🇪🇸" },
        { isoCode: "be", name: "Belarusian", flag: "🇧🇾" },
        { isoCode: "bs", name: "Bosnian", flag: "🇧🇦" },
        { isoCode: "br", name: "Breton", flag: "🇫🇷" },
        { isoCode: "bg", name: "Bulgarian", flag: "🇧🇬" },
        { isoCode: "ca", name: "Catalan", flag: "🇪🇸" },
        { isoCode: "ce", name: "Chechen", flag: "🇷🇺" },
        { isoCode: "kw", name: "Cornish", flag: "🏴" },
        { isoCode: "hr", name: "Croatian", flag: "🇭🇷" },
        { isoCode: "cs", name: "Czech", flag: "🇨🇿" },
        { isoCode: "da", name: "Danish", flag: "🇩🇰" },
        { isoCode: "nl", name: "Dutch", flag: "🇳🇱" },
        { isoCode: "eo", name: "Esperanto", flag: "eo" },
        { isoCode: "et", name: "Estonian", flag: "🇪🇪" },
        { isoCode: "fo", name: "Faroese", flag: "🇫🇴" },
        { isoCode: "gl", name: "Galician", flag: "🇪🇸" },
        { isoCode: "ka", name: "Georgian", flag: "🇬🇪" },
        { isoCode: "de", name: "German", flag: "🇩🇪" },
        { isoCode: "el", name: "Greek", flag: "🇬🇷" },
        { isoCode: "fi", name: "Finnish", flag: "🇫🇮" },
        { isoCode: "fr", name: "French", flag: "🇫🇷" },
        { isoCode: "hu", name: "Hungarian", flag: "🇭🇺" },
        { isoCode: "is", name: "Icelandic", flag: "🇮🇸" },
        { isoCode: "ia", name: "Interlingua", flag: "ia" },
        { isoCode: "ga", name: "Irish", flag: "🇮🇪" },
        { isoCode: "it", name: "Italian", flag: "🇮🇹" },
        { isoCode: "lv", name: "Latvian", flag: "🇱🇻" },
        { isoCode: "lt", name: "Lithuanian", flag: "🇱🇹" },
        { isoCode: "lb", name: "Luxembourgish", flag: "🇱🇺" },
        { isoCode: "mk", name: "Macedonian", flag: "🇲🇰" },
        { isoCode: "mt", name: "Maltese", flag: "🇲🇹" },
        { isoCode: "gv", name: "Manx", flag: "🇮🇲" },
        { isoCode: "se", name: "Northern Sami", flag: "🇳🇴" },
        { isoCode: "no", name: "Norwegian", flag: "🇳🇴" },
        { isoCode: "nb", name: "Norwegian (Bokmål)", flag: "🇳🇴" },
        { isoCode: "nn", name: "Norwegian Nynorsk", flag: "🇳🇴" },
        { isoCode: "pl", name: "Polish", flag: "🇵🇱" },
        { isoCode: "pt-PT", name: "Portuguese (Portugal)", flag: "🇵🇹" },
        { isoCode: "ro", name: "Romanian", flag: "🇷🇴" },
        { isoCode: "rm", name: "Romansh", flag: "🇨🇭" },
        { isoCode: "ru", name: "Russian", flag: "🇷🇺" },
        { isoCode: "sc", name: "Sardinian", flag: "🇮🇹" },
        { isoCode: "gd", name: "Scottish Gaelic", flag: "gd" },
        { isoCode: "sr", name: "Serbian", flag: "🇷🇸" },
        { isoCode: "sk", name: "Slovak", flag: "🇸🇰" },
        { isoCode: "sl", name: "Slovenian", flag: "🇸🇮" },
        { isoCode: "es", name: "Spanish", flag: "🇪🇸" },
        { isoCode: "sv", name: "Swedish", flag: "🇸🇪" },
        { isoCode: "tt", name: "Tatar", flag: "tt" },
        { isoCode: "tr", name: "Turkish", flag: "🇹🇷" },
        { isoCode: "uk", name: "Ukrainian", flag: "🇺🇦" },
        { isoCode: "cy", name: "Welsh", flag: "cy" },
        { isoCode: "fy", name: "Western Frisian", flag: "🇳🇱" },
        { isoCode: "yi", name: "Yiddish", flag: "🇩🇪" },
      ],
    },

    // 非洲
    {
      name: t("Africa"),
      countries: [
        { isoCode: "ar", name: "Arabic", flag: "ar" },
        { isoCode: "af", name: "Afrikaans", flag: "🇿🇦" },
        { isoCode: "ak", name: "Akan", flag: "🇬🇭" },
        { isoCode: "am", name: "Amharic", flag: "🇪🇹" },
        { isoCode: "bm", name: "Bambara", flag: "🇲🇱" },
        { isoCode: "ee", name: "Ewe", flag: "🇬🇭" },
        { isoCode: "fr", name: "French", flag: "🇫🇷" },
        { isoCode: "ff", name: "Fulah", flag: "🌍" },
        { isoCode: "lg", name: "Ganda", flag: "🇺🇬" },
        { isoCode: "ha", name: "Hausa", flag: "🇳🇬" },
        { isoCode: "ig", name: "Igbo", flag: "🇳🇬" },
        { isoCode: "ki", name: "Kikuyu", flag: "🇰🇪" },
        { isoCode: "rw", name: "Kinyarwanda", flag: "🇷🇼" },
        { isoCode: "ln", name: "Lingala", flag: "🇨🇩" },
        { isoCode: "lu", name: "Luba-Katanga", flag: "🇨🇩" },
        { isoCode: "mg", name: "Malagasy", flag: "🇲🇬" },
        { isoCode: "nd", name: "North Ndebele", flag: "🇿🇼" },
        { isoCode: "om", name: "Oromo", flag: "🇪🇹" },
        { isoCode: "rn", name: "Rundi", flag: "🇧🇮" },
        { isoCode: "sg", name: "Sango", flag: "🇨🇫" },
        { isoCode: "sn", name: "Shona", flag: "🇿🇼" },
        { isoCode: "so", name: "Somali", flag: "🇸🇴" },
        { isoCode: "sw", name: "Swahili", flag: "🇹🇿" },
        { isoCode: "ti", name: "Tigrinya", flag: "🇪🇷" },
        { isoCode: "wo", name: "Wolof", flag: "🇸🇳" },
        { isoCode: "xh", name: "Xhosa", flag: "🇿🇦" },
        { isoCode: "yo", name: "Yoruba", flag: "🇳🇬" },
        { isoCode: "zu", name: "Zulu", flag: "🇿🇦" },
      ],
    },

    // 北美洲
    {
      name: t("North America"),
      countries: [
        { isoCode: "en", name: "English", flag: "🇺🇸" },
        { isoCode: "fr", name: "French", flag: "🇨🇦" },
        { isoCode: "kl", name: "Kalaallisut", flag: "🇬🇱" },
        { isoCode: "es", name: "Spanish", flag: "🇲🇽" },
        { isoCode: "yi", name: "Yiddish", flag: "🇩🇪" },
      ],
    },

    // 南美洲
    {
      name: t("South America"),
      countries: [
        { isoCode: "pt-BR", name: "Portuguese (Brazil)", flag: "🇧🇷" },
        { isoCode: "qu", name: "Quechua", flag: "🇵🇪" },
        { isoCode: "es", name: "Spanish", flag: "🇦🇷" },
      ],
    },

    // 大洋洲
    {
      name: t("Oceania"),
      countries: [
        { isoCode: "mi", name: "Māori", flag: "🇳🇿" },
        { isoCode: "en", name: "English", flag: "🇦🇺" },
        { isoCode: "to", name: "Tongan", flag: "🇹🇴" },
      ],
    },
  ];

  const updatedLocales = useMemo(() => {
    if (source?.code && languageLocaleData) {
      return regions.map((region) => ({
        ...region,
        countries: region.countries
          .map((lang) => ({
            ...lang,
            name: `${lang.name}(${languageLocaleData[lang.isoCode]?.Local})`,
            flag: languageLocaleData[lang.isoCode]?.countries[0],
          }))
          .filter((lang) => lang.isoCode !== source?.code),
      }));
    }
  }, [source?.code, languageLocaleData]);

  const [allSelectedKeys, setAllSelectedKeys] = useState<string[]>([]); // 保存所有选中的key
  const [searchInput, setSearchInput] = useState("");
  const [filteredLanguages, setFilteredLanguages] = useState<any>([]);
  const [confirmButtonDisable, setConfirmButtonDisable] =
    useState<boolean>(false);
  const [checkedCountries, setCheckedCountries] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeKeys, setActiveKeys] = useState<string[]>([]); // 新增：管理折叠面板展开状态
  const selectedLanguage: LanguagesDataType[] = useSelector(
    (state: any) => state.languageTableData.rows,
  );
  const selectedLanguagesIscode = useMemo(
    () => selectedLanguage.map((lang) => lang.locale),
    [selectedLanguage],
  );

  const dispatch = useDispatch();
  const searchRef = useRef<InputRef>(null);
  const addLanguageTraceRef = useRef<ClientLogTrace | null>(null);
  const { consume: consumeAddResponse, reset: resetAddResponse } =
    useConsumableFetcherData<any>();

  const fetcher = useFetcher<any>();
  const addFetcher = useFetcher<any>();

  useEffect(() => {
    if (updatedLocales) {
      setFilteredLanguages(updatedLocales);
      setIsLoading(false);
      // 默认展开第一个折叠面板
      if (updatedLocales.length > 0) {
        setActiveKeys([updatedLocales[0].name]);
      }
    }
  }, [updatedLocales]);

  useEffect(() => {
    setCheckedCountries(selectedLanguagesIscode);
  }, [selectedLanguagesIscode]);

  useEffect(() => {
    const data = consumeAddResponse(addFetcher.data);
    if (data) {
      if (data?.success) {
        const rows = data.response?.map((lang: any, i: any) => ({
          key: lang.locale,
          name: lang.name,
          localeName: languageLocaleData[data.response[i].locale].Local,
          locale: lang.locale,
          status: 0,
          auto_update_translation: false,
          published: lang.published,
          loading: false,
        }));
        dispatch(updateLanguageTableData(rows));
        shopify.toast.show(t("Add success"));
        setAllSelectedKeys([]);
        setFilteredLanguages(updatedLocales);
        setIsModalOpen(false);
        setConfirmButtonDisable(false);
        finishClientLogTrace(addLanguageTraceRef.current, {
          status: "success",
          context: {
            locales: rows?.map((item: any) => item?.locale) || [],
          },
        });
        addLanguageTraceRef.current = null;
        fetcher.submit(
          {
            log: `${shop} 添加语言${rows?.map((item: any) => item?.locale)}`,
          },
          {
            method: "POST",
            action: "/log",
          },
        );
      } else {
        shopify.toast.show(t("Add failed"));
        setConfirmButtonDisable(false);
        finishClientLogTrace(addLanguageTraceRef.current, {
          level: "warn",
          status: "failure",
          message: "Add language failed",
          context: {
            locales: allSelectedKeys,
          },
        });
        addLanguageTraceRef.current = null;
      }
    }
  }, [
    addFetcher.data,
    consumeAddResponse,
    allSelectedKeys,
    dispatch,
    fetcher,
    languageLocaleData,
    shop,
    t,
    updatedLocales,
  ]);

  // 搜索逻辑
  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchInput(value);

    if (!value.trim() || !updatedLocales) {
      // 搜索框为空，恢复所有
      setFilteredLanguages(updatedLocales);
      // 恢复默认展开第一个面板
      if (updatedLocales && updatedLocales.length > 0) {
        setActiveKeys([updatedLocales[0].name]);
      }
      return;
    }

    // 搜索：遍历每个大洲，过滤出匹配的语言
    const filtered = updatedLocales
      .map((region) => {
        const matchedCountries = region.countries.filter((lang) =>
          lang.name.toLowerCase().includes(value.toLowerCase()),
        );
        return { ...region, countries: matchedCountries };
      })
      .filter((region) => region.countries.length > 0); // 只保留有匹配项的大洲

    setFilteredLanguages(filtered);

    // 展开包含匹配结果的折叠面板
    const matchedRegionNames = filtered.map((region) => region.name);
    setActiveKeys(matchedRegionNames);
  };

  // 增量更新 allSelectedLanguage
  const checkDetection = (newSelectedRowKeys: string[]) => {
    // 计算已选中的语言数量
    const addedLanguagesCount =
      newSelectedRowKeys.length + checkedCountries.length;
    // 检查是否超过20
    if (addedLanguagesCount > 20) {
      // 弹出错误提示
      shopify.toast.show("Your have reach your shopify plan limit(Max<=20)");
      return true;
    }
    return false;
  };

  // 判断某个大洲是否全选
  const isRegionChecked = (region: any) =>
    region.countries.every((c: any) => checkedCountries.includes(c.isoCode));

  // 判断某个大洲是否部分选中
  const isRegionIndeterminate = (region: any) =>
    region.countries.some((c: any) => checkedCountries.includes(c.isoCode)) &&
    !isRegionChecked(region);

  // 切换大洲
  const handleRegionChange = (region: any, checked: boolean) => {
    const countryNames = region.countries.map((c: any) => c.isoCode);
    if (checked) {
      if (checkDetection(countryNames)) {
        return;
      }
      setAllSelectedKeys([...allSelectedKeys, ...countryNames]);
      setCheckedCountries(
        Array.from(new Set([...checkedCountries, ...countryNames])),
      );
    } else {
      setAllSelectedKeys(
        allSelectedKeys.filter((isoCode) => !countryNames.includes(isoCode)),
      );
      setCheckedCountries(
        checkedCountries.filter(
          (isoCode) =>
            !countryNames.includes(isoCode) ||
            selectedLanguagesIscode.includes(isoCode),
        ),
      );
    }
  };

  // 切换国家
  const handleCountryChange = (country: any, checked: boolean) => {
    if (checked) {
      if (checkDetection([country.isoCode])) {
        return;
      }
      setAllSelectedKeys([...allSelectedKeys, country.isoCode]);
      setCheckedCountries([...checkedCountries, country.isoCode]);
    } else {
      setAllSelectedKeys(
        allSelectedKeys.filter((isoCode) => isoCode !== country.isoCode),
      );
      setCheckedCountries(
        checkedCountries.filter((isoCode) => isoCode !== country.isoCode),
      );
    }
  };

  // 确认选择 -> 触发 action
  const handleConfirm = () => {
    resetAddResponse();
    addLanguageTraceRef.current = startClientLogTrace({
      event: "language_add",
      action: "add_languages",
      shop,
      context: {
        locales: allSelectedKeys,
        primaryLanguage: source?.code,
      },
    });
    const formData = new FormData();
    formData.append(
      "addLanguages",
      JSON.stringify({
        selectedLanguages: allSelectedKeys,
        primaryLanguage: source?.code,
      }),
    ); // 将选中的语言作为字符串发送
    addFetcher.submit(formData, {
      method: "POST",
      action: "/app/language",
    }); // 提交表单请求
    setSearchInput(""); // 清除搜索框内容
    setConfirmButtonDisable(true);
  };

  const handleCloseModal = () => {
    setSearchInput(""); // 清除搜索框内容
    setAllSelectedKeys([]);
    setCheckedCountries(selectedLanguagesIscode);
    setFilteredLanguages(updatedLocales);
    // 重置折叠面板状态，默认展开第一个
    if (updatedLocales && updatedLocales.length > 0) {
      setActiveKeys([updatedLocales[0].name]);
    }
    setIsModalOpen(false); // 关闭Modal
  };

  // 移除已选中的语言
  const handleRemoveLanguage = (key: string) => {
    setAllSelectedKeys(allSelectedKeys.filter((isoCode) => isoCode !== key));
    setCheckedCountries(checkedCountries.filter((isoCode) => isoCode !== key));
  };

  const collapseItems = useMemo<CollapseProps["items"]>(
    () =>
      filteredLanguages.map((state: any) => ({
        key: state.name,
        label: (
          <>
            <Checkbox
              checked={isRegionChecked(state)}
              indeterminate={isRegionIndeterminate(state)}
              onClick={(e) => {
                e.stopPropagation();
                handleRegionChange(state, !isRegionChecked(state));
              }}
            />
            <span style={{ marginLeft: 8 }}>{state.name}</span>
          </>
        ),
        children: state?.countries.map((country: any, index: number) => (
          <div
            key={country?.name}
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: 12,
              marginLeft: 24,
            }}
          >
            <Checkbox
              checked={checkedCountries.includes(country?.isoCode)}
              onChange={(e) => handleCountryChange(country, e.target.checked)}
              style={{ marginRight: 8 }}
              disabled={selectedLanguagesIscode.includes(country?.isoCode)}
            />
            <img
              key={index}
              src={country?.flag}
              alt={`${country?.name} flag`}
              style={{
                width: "30px",
                height: "auto",
                border: "1px solid #888",
                borderRadius: "2px",
                marginRight: 4,
              }}
            />
            <span>{country?.name}</span>
          </div>
        )),
      })),
    [
      filteredLanguages,
      checkedCountries,
      selectedLanguagesIscode,
      allSelectedKeys,
    ],
  );

  return (
    <AppSModal
      open={isVisible}
      heading={t("Select Languages")}
      onClose={handleCloseModal}
      size="large-100"
      primaryAction={{
        content: t("Add"),
        onAction: handleConfirm,
        disabled: confirmButtonDisable || allSelectedKeys.length === 0,
        loading: confirmButtonDisable,
      }}
      secondaryActions={[
        {
          content: t("Cancel"),
          onAction: handleCloseModal,
        },
      ]}
    >
      <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
      <Input
        ref={searchRef}
        placeholder={t("Search languages...")}
        prefix={<SearchOutlined />}
        value={searchInput}
        onChange={handleSearch}
        style={{ marginBottom: 16 }}
      />

      <Space wrap style={{ marginBottom: 16 }}>
        {allSelectedKeys.map((key) => {
          const language = languageLocaleData[key]?.Name || key;
          return (
            <SelectedTag
              key={key}
              item={language!}
              onRemove={() => handleRemoveLanguage(key)}
            />
          );
        })}
      </Space>

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
      ) : filteredLanguages.length ? (
        <Collapse
          activeKey={activeKeys}
          onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys : [keys])}
          items={collapseItems}
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t("Language not found")}
        />
      )}
      </div>
    </AppSModal>
  );
};

export default AddLanguageModal;
