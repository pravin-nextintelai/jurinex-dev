import PropTypes from "prop-types"
import gavel from "../../assets/jurinex-gavel.png"
import wordtext from "../../assets/jurinex-wordtext.png"
import wordtextLight from "../../assets/jurinex-wordtext-light.png"

/**
 * JURINEX™ brand lockup: the teal gavel tile followed by the wordmark.
 * The tile is a CSS teal square with the white gavel glyph on top, so it
 * renders identically on the transparent hero header and the solid white
 * bar with no edge fringe; only the type switches between ink and white.
 */
const BrandLogo = ({ size = "md", light = false }) => {
  const heightClass = size === "lg" ? "h-10" : "h-9"
  const tileClass = size === "lg" ? "h-10 w-10" : "h-9 w-9"

  return (
    <span className="inline-flex flex-none items-center gap-1.5">
      {/* The teal tile is drawn in CSS so its edge stays crisp on any header. */}
      <span className={`${tileClass} flex-none overflow-hidden rounded-md bg-nx-teal`}>
        <img src={gavel} alt="" aria-hidden="true" className="h-full w-full" />
      </span>
      <img
        src={light ? wordtextLight : wordtext}
        alt="JURINEX"
        className={`${heightClass} w-auto flex-none`}
      />
    </span>
  )
}

BrandLogo.propTypes = {
  size: PropTypes.oneOf(["md", "lg"]),
  light: PropTypes.bool,
}

export default BrandLogo
