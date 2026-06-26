import type { ThemeConfig } from 'antd';
import { theme as antdTheme } from 'antd';
import { palette } from './constants/theme';

const theme: ThemeConfig = {
  algorithm: antdTheme.darkAlgorithm,
  token: {
    fontSize: 14,
    colorPrimary: palette.primary,
    colorInfo: palette.accentCyan,
    colorLink: palette.accentCyan,
    colorSuccess: palette.accentCyan,
    colorBgBase: palette.bgBase,
    colorBgContainer: palette.bgSurface,
    colorBgElevated: palette.bgElevated,
    colorBgLayout: palette.bgBase,
    colorText: palette.text,
    colorTextSecondary: palette.textSecondary,
    colorTextTertiary: palette.textMuted,
    colorBorder: palette.borderSubtle,
    borderRadius: 8,
  },
  components: {
    Layout: {
      headerBg: palette.bgMuted,
      bodyBg: palette.bgBase,
    },
    Button: {
      fontWeight: 500,
      primaryShadow: palette.glowOrange,
    },
    Card: {
      colorBgContainer: palette.bgSurface,
      colorBorderSecondary: palette.borderSubtle,
    },
    Steps: {
      colorPrimary: palette.accentCyan,
      colorText: palette.textSecondary,
      colorTextDescription: palette.textMuted,
    },
    Input: {
      activeBorderColor: palette.accentCyan,
      hoverBorderColor: palette.border,
    },
    Progress: {
      defaultColor: palette.accentCyan,
    },
    Result: {
      colorSuccess: palette.accentCyan,
    },
  },
};

export default theme;
