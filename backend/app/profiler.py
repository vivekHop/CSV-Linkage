import io
import pandas as pd
import numpy as np
from typing import Dict, Any, List, Tuple

def clean_value_for_json(val: Any) -> Any:
    """
    Helper to convert numpy/pandas data types to JSON-serializable Python native types.
    """
    if pd.isna(val) or val is None:
        return None
    if isinstance(val, (np.integer, np.int64, np.int32, np.int16, np.int8)):
        return int(val)
    if isinstance(val, (np.floating, np.float64, np.float32, np.float16)):
        return float(val)
    if isinstance(val, np.ndarray):
        return [clean_value_for_json(x) for x in val.tolist()]
    if isinstance(val, (pd.Timestamp, datetime_type := type(pd.NaT))):
        return val.isoformat() if hasattr(val, "isoformat") else str(val)
    return str(val)

def _profile_dataframe(df: pd.DataFrame, asset_name: str, file_size: int, asset_type: str) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    row_count = len(df)
    column_count = len(df.columns)
    
    asset_metadata = {
        "name": asset_name,
        "asset_type": asset_type,
        "row_count": row_count,
        "column_count": column_count,
        "file_size": file_size,
        "description": f"Uploaded {asset_type.upper()} sheet containing {column_count} columns and {row_count} rows.",
        "owner": "Workspace User",
        "version": 1,
        "notes": "",
        "tags": ["uploaded"],
        "custom_attributes": {}
    }
    
    columns_metadata = []
    
    for col_name in df.columns:
        col_name_str = str(col_name)
        series = df[col_name]
        
        # Calculate nullable percentage
        null_count = series.isna().sum()
        nullable_percentage = float((null_count / row_count) * 100.0) if row_count > 0 else 0.0
        
        # Calculate distinct count (excluding nulls)
        distinct_count = int(series.dropna().nunique())
        
        # Calculate duplicate count
        non_null_count = row_count - null_count
        duplicate_count = max(0, int(non_null_count - distinct_count))
        
        # Detect data type
        dtype_str = str(series.dtype)
        if dtype_str.startswith("int") or dtype_str.startswith("uint"):
            datatype = "INTEGER"
        elif dtype_str.startswith("float"):
            datatype = "FLOAT"
        elif dtype_str.startswith("bool"):
            datatype = "BOOLEAN"
        elif dtype_str.startswith("datetime"):
            datatype = "DATETIME"
        else:
            datatype = "STRING"
            
        # Initialize stats
        col_min = None
        col_max = None
        col_mean = None
        col_median = None
        
        # Calculate min and max
        if non_null_count > 0:
            try:
                col_min = clean_value_for_json(series.min())
                col_max = clean_value_for_json(series.max())
            except Exception:
                pass
                
        # Calculate mean and median for numeric columns
        if datatype in ("INTEGER", "FLOAT") and non_null_count > 0:
            try:
                numeric_series = pd.to_numeric(series.dropna(), errors="coerce")
                if not numeric_series.empty:
                    col_mean = float(numeric_series.mean())
                    col_median = float(numeric_series.median())
            except Exception:
                pass
                
        # Extract sample values (limit to 5)
        sample_raw = series.dropna().head(5).tolist()
        sample_values = [clean_value_for_json(x) for x in sample_raw]
        
        col_meta = {
            "name": col_name_str,
            "datatype": datatype,
            "nullable_percentage": nullable_percentage,
            "distinct_count": distinct_count,
            "duplicate_count": duplicate_count,
            "min": str(col_min) if col_min is not None else None,
            "max": str(col_max) if col_max is not None else None,
            "mean": col_mean,
            "median": col_median,
            "sample_values": sample_values,
            "description": f"Column '{col_name_str}' ({datatype})",
            "notes": "",
            "tags": [],
            "custom_attributes": {}
        }
        
        columns_metadata.append(col_meta)
        
    return asset_metadata, columns_metadata

def profile_file(file_bytes: bytes, file_name: str) -> List[Tuple[Dict[str, Any], List[Dict[str, Any]]]]:
    """
    Profiles any spreadsheet or CSV file in-memory.
    If the file has multiple tabs (like Excel), profiles each tab separately.
    """
    lower_name = file_name.lower()
    file_size = len(file_bytes)
    
    # 1. Excel spreadsheets
    if lower_name.endswith(('.xlsx', '.xls', '.xlsm', '.ods')):
        xl = pd.ExcelFile(io.BytesIO(file_bytes))
        results = []
        for sheet_name in xl.sheet_names:
            df = xl.parse(sheet_name)
            asset_name = f"{file_name} [{sheet_name}]"
            asset_meta, col_meta = _profile_dataframe(df, asset_name, file_size, asset_type="excel")
            results.append((asset_meta, col_meta))
        return results

    # 2. Tab-separated values
    elif lower_name.endswith(('.tsv', '.txt')):
        df = pd.read_csv(io.BytesIO(file_bytes), sep='\t')
        asset_meta, col_meta = _profile_dataframe(df, file_name, file_size, asset_type="tsv")
        return [(asset_meta, col_meta)]

    # 3. CSV (Default fallback)
    else:
        df = pd.read_csv(io.BytesIO(file_bytes))
        asset_meta, col_meta = _profile_dataframe(df, file_name, file_size, asset_type="csv")
        return [(asset_meta, col_meta)]
