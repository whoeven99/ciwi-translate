import { createSlice, PayloadAction } from "@reduxjs/toolkit";

interface UserConfigState {
  shop: string;
  source: {
    code: string;
    name: string;
  };
  plan: {
    id: number;
    type: string;
    feeType: number;
    isInFreePlanTime: boolean;
  };
  updateTime: string | null;
  chars: number | undefined;
  totalChars: number | undefined;
  /** 试用 / Launch Credits 池（Account.trialCredits）。 */
  trialCredits: number | undefined;
  /** 购买积分池面额（Account.purchasedCredits）。 */
  purchasedCredits: number | undefined;
  /** 可迁移购买积分。 */
  migratablePurchasedCredits: number | undefined;
  userConfigIsLoading: boolean;
  isNew: boolean | null;
}

const initialState: UserConfigState = {
  shop: "",
  source: {
    code: "",
    name: "",
  },
  plan: {
    id: 0,
    type: "",
    feeType: 0,
    isInFreePlanTime: false,
  },
  updateTime: null,
  chars: 0,
  totalChars: 0,
  trialCredits: 0,
  purchasedCredits: 0,
  migratablePurchasedCredits: 0,
  userConfigIsLoading: true,
  isNew: null,
};

const userConfigSlice = createSlice({
  name: "userConfig",
  initialState,
  reducers: {
    setPlan: (
      state,
      action: PayloadAction<{
        plan: {
          id: number;
          type: string;
          feeType: number;
          isInFreePlanTime: boolean;
        };
      }>,
    ) => {
      state.plan = action.payload.plan;
    },
    setSource: (
      state,
      action: PayloadAction<{
        source: {
          code: string;
          name: string;
        };
      }>,
    ) => {
      state.source = action.payload.source;
    },
    setUpdateTime: (state, action: PayloadAction<{ updateTime: string }>) => {
      state.updateTime = action.payload.updateTime;
    },
    setShop: (state, action: PayloadAction<{ shop: string }>) => {
      state.shop = action.payload.shop;
    },
    setChars: (state, action: PayloadAction<{ chars: number | undefined }>) => {
      state.chars = action.payload.chars;
    },
    setTotalChars: (
      state,
      action: PayloadAction<{ totalChars: number | undefined }>,
    ) => {
      state.totalChars = action.payload.totalChars;
    },
    setTrialCredits: (
      state,
      action: PayloadAction<{ trialCredits: number | undefined }>,
    ) => {
      state.trialCredits = action.payload.trialCredits;
    },
    setPurchasedCredits: (
      state,
      action: PayloadAction<{ purchasedCredits: number | undefined }>,
    ) => {
      state.purchasedCredits = action.payload.purchasedCredits;
    },
    setMigratablePurchasedCredits: (
      state,
      action: PayloadAction<{ migratablePurchasedCredits: number | undefined }>,
    ) => {
      state.migratablePurchasedCredits = action.payload.migratablePurchasedCredits;
    },
    setUserConfigIsLoading: (
      state,
      action: PayloadAction<{ isLoading: boolean }>,
    ) => {
      state.userConfigIsLoading = action.payload.isLoading;
    },
    setIsNew: (state, action: PayloadAction<{ isNew: boolean }>) => {
      state.isNew = action.payload.isNew;
    },
  },
});

export const {
  setPlan,
  setSource,
  setUpdateTime,
  setShop,
  setChars,
  setTotalChars,
  setTrialCredits,
  setPurchasedCredits,
  setMigratablePurchasedCredits,
  setUserConfigIsLoading,
  setIsNew,
} = userConfigSlice.actions;

const reducer = userConfigSlice.reducer;
export default reducer;
