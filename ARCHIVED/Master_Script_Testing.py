import re
import pandas as pd

# Helper to parse mixed date formats according to your rules
def parse_date(value):
    # 3) Blank → default to 2019-05-31
    if pd.isna(value) or str(value).strip() == '':
        return pd.Timestamp('2019-05-31')

    s = str(value).strip()

    # 1) If already YYYY-MM-DD, keep as is
    if re.match(r'^\d{4}-\d{2}-\d{2}$', s):
        try:
            return pd.to_datetime(s, format='%Y-%m-%d')
        except ValueError:
            pass

    # 2a) Month name / Year → YYYY-MM-01
    try:
        dt = pd.to_datetime(s, format='%B/%Y')
        return dt.replace(day=1)
    except ValueError:
        pass

    # 2b) Numeric month/year → YYYY-MM-01
    try:
        dt = pd.to_datetime(s, format='%m/%Y')
        return dt.replace(day=1)
    except ValueError:
        pass

    # Fallback: generic parse, if it includes a day assume it
    try:
        return pd.to_datetime(s, errors='coerce')
    except Exception:
        return pd.NaT


# Load all sheets
input_path = r'C:\Users\Intern1\Desktop\Zeyu\A-SPEC Dashboard\A-SPEC CODELISTS Version 2.0.5 MASTER WIP - 20250528.xlsx'
sheets = pd.read_excel(input_path, sheet_name=None)

# Column rename mapping
rename_map = {
    'CODELIST': 'Codelist_Name',
    'Code': 'Code_Value',
    'Date Added or Modified': 'Date_Modified'
}

standardized_sheets = {}
for sheet_name, df in sheets.items():
    # 1) Rename headers
    df = df.rename(columns=rename_map)

    # 2) Rename long header to Spec_Coverage
    long_hdr = next((c for c in df.columns if 'Codes involved in both DDS' in str(c)), None)
    if long_hdr:
        df = df.rename(columns={long_hdr: 'Spec_Coverage'})

    # 3) Standardize Date_Modified
    if 'Date_Modified' in df.columns:
        df['Date_Modified'] = (
            df['Date_Modified']
              .apply(parse_date)             # apply our new logic
              .dt.strftime('%Y-%m-%d')       # format as ISO
        )

    standardized_sheets[sheet_name] = df

# Write out to a new Excel
output_path = r'C:\Users\Intern1\Desktop\Zeyu\A-SPEC Dashboard\A-SPEC CODELISTS Version Testing_Final.xlsx'
with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
    for name, df in standardized_sheets.items():
        df.to_excel(writer, sheet_name=name, index=False)

print(f"Standardized workbook written to: {output_path}")
