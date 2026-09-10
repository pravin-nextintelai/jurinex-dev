import PropTypes from "prop-types"
import wordmark from "../../assets/jurinex-wordmark.png"
import wordmarkLight from "../../assets/jurinex-wordmark-light.png"

/**
 * JURINEX™ brand lockup — official logo artwork (teal gavel tile + wordmark).
 * The light variant carries white type for use on dark surfaces.
 */
const BrandLogo = ({ size = "md", light = false }) => {
  const heightClass = size === "lg" ? "h-10" : "h-9"

  return (
    <img
      src={light ? wordmarkLight : wordmark}
      alt="JURINEX"
      className={`${heightClass} w-auto flex-none`}
    />
  )
}

BrandLogo.propTypes = {
  size: PropTypes.oneOf(["md", "lg"]),
  light: PropTypes.bool,
}

export default BrandLogo
