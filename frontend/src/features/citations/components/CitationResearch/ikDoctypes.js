// Indian Kanoon document-type categories — mirrors IK's own /advsearch form:
// same category grouping, same doctype tokens, same labels. Used by the
// Advanced Search popup (all categories) and the issues-step court scope
// (court categories only). Selected tokens are sent comma-joined as the
// doctypes: directive.
export const DOCTYPE_CATEGORIES = [
  {
    key: 'sc',
    label: 'Supreme Court',
    options: [
      ['supremecourt', 'Supreme Court'],
      ['scorders', 'SC — Daily Orders'],
    ],
  },
  {
    key: 'highcourts',
    label: 'High Courts',
    options: [
      ['allahabad', 'Allahabad'], ['andhra', 'Andhra'], ['amravati', 'Andhra — Amravati'],
      ['bombay', 'Bombay'], ['kolkata', 'Kolkata'], ['kolkata_app', 'Kolkata Appellate'],
      ['chattisgarh', 'Chattisgarh'], ['delhi', 'Delhi'], ['delhiorders', 'Delhi — Orders'],
      ['gauhati', 'Gauhati'], ['gujarat', 'Gujarat'], ['himachal_pradesh', 'Himachal Pradesh'],
      ['jammu', 'Jammu'], ['srinagar', 'Srinagar'], ['jharkhand', 'Jharkhand'],
      ['karnataka', 'Karnataka'], ['kerala', 'Kerala'], ['madhyapradesh', 'Madhya Pradesh'],
      ['manipur', 'Manipur'], ['meghalaya', 'Meghalaya'], ['chennai', 'Madras'],
      ['orissa', 'Orissa'], ['patna', 'Patna'], ['patna_orders', 'Patna — Orders'],
      ['punjab', 'Punjab-Haryana'], ['jaipur', 'Jaipur'], ['jodhpur', 'Jodhpur'],
      ['sikkim', 'Sikkim'], ['uttaranchal', 'Uttarakhand'], ['tripura', 'Tripura'],
      ['telangana', 'Telangana'],
    ],
  },
  {
    key: 'districtcourts',
    label: 'District Courts',
    options: [
      ['delhidc', 'Delhi District Court'],
      ['bangaloredc', 'Bangalore District Court'],
    ],
  },
  {
    key: 'tribunals',
    label: 'Tribunals',
    options: [
      ['aptel', 'APTEL'], ['authority', 'Authority'], ['cat', 'CAT'], ['cegat', 'CEGAT'],
      ['cerc', 'CERC'], ['cic', 'CIC'], ['clb', 'CLB'], ['consumer', 'Consumer Courts'],
      ['copyrightboard', 'Copyright Board'], ['drat', 'Debt Recovery'],
      ['greentribunal', 'Green Tribunal'], ['cci', 'Competition Commission'],
      ['ipab', 'IPAB'], ['itat', 'ITAT'], ['mrtp', 'Monopoly (MRTP)'], ['sebisat', 'SAT'],
      ['stt', 'State Taxation'], ['tdsat', 'TDSAT'], ['trademark', 'Trademark'],
      ['cestat', 'CESTAT'], ['nclat', 'NCLAT'],
    ],
  },
  {
    key: 'laws',
    label: 'Laws',
    options: [
      ['union-laws', 'Union of India'], ['constitution-and-amendments', 'Constitution & Amendments'],
      ['treaties', 'International Treaties'], ['unitednations', 'UN Treaties'],
      ['andhra-laws', 'Andhra'], ['arunachal-laws', 'Arunachal'], ['assam-laws', 'Assam'],
      ['bihar-laws', 'Bihar'], ['chandigarh-laws', 'Chandigarh'], ['chattisgarh-laws', 'Chattisgarh'],
      ['delhi-laws', 'Delhi'], ['goa-laws', 'Goa'], ['gujarat-laws', 'Gujarat'],
      ['haryana-laws', 'Haryana'], ['himachal-laws', 'Himachal'], ['jk-laws', 'Jammu & Kashmir'],
      ['jharkhand-laws', 'Jharkhand'], ['karnataka-laws', 'Karnataka'], ['kerala-laws', 'Kerala'],
      ['mp-laws', 'Madhya Pradesh'], ['mh-laws', 'Maharashtra'], ['manipur-laws', 'Manipur'],
      ['meghalaya-laws', 'Meghalaya'], ['mizoram-laws', 'Mizoram'], ['nagaland-laws', 'Nagaland'],
      ['odisha-laws', 'Odisha'], ['puducherry-laws', 'Puducherry'], ['punjab-laws', 'Punjab'],
      ['rajasthan-laws', 'Rajasthan'], ['sikkim-laws', 'Sikkim'], ['tn-laws', 'Tamil Nadu'],
      ['telengana-laws', 'Telangana'], ['tripura-laws', 'Tripura'], ['uttarakhand-laws', 'Uttarakhand'],
      ['up-laws', 'Uttar Pradesh'], ['wb-laws', 'West Bengal'], ['andaman-laws', 'Andaman'],
      ['dadra-laws', 'Dadra'], ['lakshadweep-laws', 'Lakshadweep'], ['daman-laws', 'Daman'],
      ['eci', 'Election Commission'], ['fssai', 'FSSAI'], ['irdai', 'IRDAI'], ['rbi', 'RBI'],
      ['sebi', 'SEBI'], ['trai', 'TRAI'], ['bis', 'BIS'], ['cbfc', 'CBFC'],
      ['bengaluru-laws', 'Bengaluru'], ['british-india', 'British India'],
      ['mysore-laws', 'Mysore (Princely)'], ['nagpurprovince-laws', 'Nagpur Province'],
      ['britishpunjab-laws', 'Punjab Province'], ['utdprovinces-laws', 'United Provinces'],
      ['centralprovinces-laws', 'Central Provinces'], ['chotanagpur-laws', 'Chota Nagpur Division'],
      ['bhopal-laws', 'Bhopal (Princely)'], ['bombay-laws', 'Bombay Presidency'],
      ['bengalpresidency-laws', 'Bengal Presidency'], ['madhyabharat-laws', 'Madhya Bharat'],
      ['madras-laws', 'Madras Presidency'], ['vindhya-laws', 'Vindhya'],
    ],
  },
  {
    key: 'others',
    label: 'Others',
    options: [
      ['lawcommission', 'Law Commission'], ['debates', 'CA Debates'],
      ['loksabha', 'Lok Sabha'], ['rajyasabha', 'Rajya Sabha'],
    ],
  },
];

export default DOCTYPE_CATEGORIES;
