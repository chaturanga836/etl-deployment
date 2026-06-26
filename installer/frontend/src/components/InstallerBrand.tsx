import { Typography } from 'antd';
import { BRAND_LOGO_ALT, BRAND_LOGO_SRC, BRAND_TAGLINE } from '../constants/brand';

const { Text } = Typography;

type InstallerBrandProps = {
  variant?: 'header' | 'hero';
  showTagline?: boolean;
};

export default function InstallerBrand({
  variant = 'header',
  showTagline = false,
}: InstallerBrandProps) {
  const logoHeight = variant === 'hero' ? 48 : 36;

  return (
    <div className={`installer-brand installer-brand--${variant}`}>
      <img
        src={BRAND_LOGO_SRC}
        alt={BRAND_LOGO_ALT}
        className="installer-brand__logo"
        height={logoHeight}
      />
      {variant === 'header' && (
        <Text className="installer-brand__badge">Setup</Text>
      )}
      {showTagline && (
        <Text className="installer-brand__tagline">{BRAND_TAGLINE}</Text>
      )}
    </div>
  );
}
