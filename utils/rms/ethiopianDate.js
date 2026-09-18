// Gregorian → Ethiopian calendar, for the Amharic dates letters carry.
//
// The guaranty letters date themselves with the ethiopic-date package, which
// can only say "today". A release notice must print the release date — any
// day — so the conversion lives here: the Julian-day form of the standard
// algorithm, with the month names that package uses (CLDR "am", wide) and
// Arabic digits, e.g. "መስከረም 7 ቀን 2017 ዓ.ም".

const JD_EPOCH_OFFSET_AMETE_MIHRET = 1723856;

export const ETHIOPIAN_MONTHS_AM = [
    "መስከረም",
    "ጥቅምት",
    "ኅዳር",
    "ታኅሣሥ",
    "ጥር",
    "የካቲት",
    "መጋቢት",
    "ሚያዝያ",
    "ግንቦት",
    "ሰኔ",
    "ሐምሌ",
    "ነሐሴ",
    "ጳጉሜን",
];

export const gregorianToJdn = (year, month, day) => {
    const a = Math.floor((14 - month) / 12);
    const y = year + 4800 - a;
    const m = month + 12 * a - 3;
    return (
        day +
        Math.floor((153 * m + 2) / 5) +
        365 * y +
        Math.floor(y / 4) -
        Math.floor(y / 100) +
        Math.floor(y / 400) -
        32045
    );
};

export const jdnToEthiopian = (jdn) => {
    const since = jdn - JD_EPOCH_OFFSET_AMETE_MIHRET;
    const r = since % 1461;
    const n = (r % 365) + 365 * Math.floor(r / 1460);
    const year = 4 * Math.floor(since / 1461) + Math.floor(r / 365) - Math.floor(r / 1460);
    const month = Math.floor(n / 30) + 1;
    const day = (n % 30) + 1;
    return { year, month, day };
};

// The Ethiopian date of the East Africa Time calendar day (UTC+3, no DST)
// the instant falls on.
export const toEthiopian = (date) => {
    const dt = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(dt.getTime())) return null;
    const eat = new Date(dt.getTime() + 3 * 3600 * 1000);
    return jdnToEthiopian(gregorianToJdn(eat.getUTCFullYear(), eat.getUTCMonth() + 1, eat.getUTCDate()));
};

export const formatEthiopianAm = (date) => {
    const e = toEthiopian(date);
    if (!e) return "";
    return `${ETHIOPIAN_MONTHS_AM[e.month - 1]} ${e.day} ቀን ${e.year} ዓ.ም`;
};
