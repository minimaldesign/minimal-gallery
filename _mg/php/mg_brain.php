<?php

// REQUIRED //

error_reporting(0);

// general preferences
require_once('mg_prefs.php');
// exif stuff by Jake Olefsky (http://www.offsky.com/software/exif/index.php)
require_once('info_photo/exif.php');

// miscelaneous variables
$mg_version = '0.8.1';

// in case register_globals in php.ini is Off
$id = $_REQUEST['id'];				// file identifier
$y = $_REQUEST['y'];				// filtering of files by year
$m = $_REQUEST['m'];				// filtering of files by month
$d = $_REQUEST['d'];				// filtering of files by day
$t = $_REQUEST['t'];				// filtering of files by raw ul time
$c = $_REQUEST['c'];				// filtering of files by category
$s = $_REQUEST['s'];				// sorting options - 'y'-> year 'm'-> month 'd'-> day 't'-> time 'c'-> category 'n'-> name
$o = $_REQUEST['o'];				// sorting order options - 'asc' 'desc'
$x = $_REQUEST['x'];				// extended info switcher - 'x=1'-> show 'x=0'-> hide

$p = $_REQUEST['p'];				// thumbnail page number
$view = $_REQUEST['view'];			// view style - 'list' 'thumb' 'img' - stored in cookie
$style = $_REQUEST['style'];		// css style switcher - stored in cookie
$slides = $_REQUEST['slides'];		// slide show
$sort = $_REQUEST['sort'];			// archives sorting order

// LOCATION VARIABLES & FUNCTIONS //
$script_name = eregi_replace("[^[:alnum:]+]"," ",basename($_SERVER['PHP_SELF'], ".php"));
$site_uri = 'http://'.$_SERVER['SERVER_NAME'];
$path2mg = dirname($_SERVER['PHP_SELF']);
$here = basename($_SERVER['PHP_SELF']);

// adds QUERY_STRING only when appropriate
// $and variable useful if QUERY_STRING needs to be passed as header (like for the slide show option)
function my_QUERY_STRING($filter='none', $new_value='none', $and='&amp;') {
	global $here, $id, $y, $m, $d, $t, $c, $s, $o, $x, $p, $slides;
	// for sorting and filtering of list view in table first row
	$my_query_values = array('c' => $c,
							'y' => $y,
							'm' => $m,
							'd' => $d,
							't' => $t,
							's' => $s,
							'o' => $o,
							'id' => $id,
							'p' => $p,
							'x' => $x,
							'slides' => $slides,
						);
	foreach ($my_query_values as $k => $v) {
		if (isset($v) && $k!=$filter) {
			$my_queries_array[] = "$k=$v";
		} elseif  (isset($v) && $k=$filter && $new_value!=='none') {			// 3rd conditional (when you need external value like for switchers type) creates suspicious behavior from this function - !!TEST THOROUGHLY!!
			$my_queries_array[] = "$filter=$new_value";							// fixed by removing any ambiguity as of $k value w/ $filter=$new_value instead of $k=$new_value
		}
	}
	for($i=0; $i<count($my_queries_array); $i++) {
		if($i<count($my_queries_array)-1) {										// conditional for '&' only between variables
			$my_query = $my_query.$my_queries_array[$i].$and;
		} else {
			$my_query = $my_query.$my_queries_array[$i];			
		}
	}
	if (!is_null($my_queries_array)) {											// add '?' only if there's a query string
		$my_query = '?'.$my_query;
	}
	$my_query = $here.$my_query;
	return $my_query;
}

// VIEWS //

// sets cookie to remember view between visits
if (!isset($_COOKIE['current_view'])) {											// if cookie ain't set
	setcookie('current_view', $default_view, time()+2592000, $path2mg);
	$current_view = $default_view;
	} else if (isset($view)) {													// if cookie set and switching
	setcookie('current_view', $view, time()+2592000, $path2mg);
	$current_view = $view;
	} else if (!isset($view)) {													// if cookie set and ain't switching
	$current_view = $_COOKIE['current_view'];
}

// THEMES //

// scans $template_dir for themes and populates $templates
$template_dir = './_mg/templates/';
if ($dh03 = opendir($template_dir)) {
	while (($template = readdir($dh03)) !== false) {
		if($template != "." && $template != ".." && $template != ".svn" && is_dir("$template_dir$template")) {
			$templates[] = $template;
		}
	}
}
closedir($dh03);

// cleans up and arrange $templates array
$total_templates = count($templates);
natcasesort($templates);
$templates_sorted = array_slice($templates, 0, $total_templates);
for ($i=0; $i<$total_templates; $i++) {
	$templates_name[$i] = eregi_replace("[^[:alnum:]+]"," ",$templates_sorted[$i]);
}

// sets cookie to remember style between visits if $theme = 'multi'
if ($theme == 'multi') {
	if (!isset($_COOKIE['current_theme'])) {									// if cookie ain't set
		setcookie('current_theme', $templates_sorted[0], time()+2592000, $path2mg);
		$current_theme = $templates_sorted[0];
	} else {																	// if cookie set
		if (isset($style)) {													// if switching
			if (in_array($style, $templates)) {									// making sure template is still in folder
				setcookie('current_theme', $style, time()+2592000, $path2mg);
				$current_theme = $style;
			} else {
				setcookie('current_theme', $templates_sorted[0], time()+2592000, $path2mg);
				$current_theme = $templates_sorted[0];
			}			
		} elseif (!isset($style)) {												// if not switching
			if (in_array($_COOKIE['current_theme'], $templates)) {				// making sure template is still in folder
				$current_theme = $_COOKIE['current_theme'];
			} else {
				$current_theme = $templates_sorted[0];
			}
		}
	}
}

// $current theme if multi ain't selected
if ($theme != 'multi') {
	$current_theme = $theme;
}

// SCAN OF MEDIA DIRECTORIES //

// scans $media_dir for categories-folders and populates $catz
if ($dh01 = opendir($media_dir)) {
	while (($cat = readdir($dh01)) !== false) {
		if($cat != "." && $cat != ".." && $cat != ".svn" && $cat != "_mg" && is_dir("$media_dir$cat")) {
// scans $cat for media files and populates $filez
			$cat_dir = "$media_dir$cat/";
			if ($dh02 = opendir($cat_dir)) {
				while (($file = readdir($dh02)) !== false) {
					if($file != ".DS_Store" && strtolower(end(explode('.',$file))) != "txt" && is_file("$cat_dir$file")) {	// 1st condition for OS X, 2nd to ignore description txt files
// creates main array with all files + sorting creteria				
					$main[] = array('file_id' => strtolower(eregi_replace("[^[:alnum:]+]","_",$cat)).'__'.eregi_replace("[^[:alnum:]+]","_",strtolower(reset(explode('.',$file)))),
									'file_name' => "$file",
									'name_sort' => eregi_replace("[^[:alnum:]+]","_",strtolower(reset(explode('.',$file)))),
									'name_display' => eregi_replace("[^[:alnum:]+]"," ",reset(explode('.',$file))),
									'category' => "$cat",
									'category_sort' => strtolower(eregi_replace("[^[:alnum:]+]","_",$cat)),
									'category_display' => eregi_replace("[^[:alnum:]+]"," ",$cat),
									'ul_date_display' => date("l, F jS Y", (filemtime("$cat_dir$file"))),
									'ul_time_display' => date("h:i A", (filemtime("$cat_dir$file"))),
									'ul_year_sort' => date("Y", (filemtime("$cat_dir$file"))),
									'ul_month_sort' => date("m", (filemtime("$cat_dir$file"))),
									'ul_day_sort' => date("d", (filemtime("$cat_dir$file"))),
									'ul_time_sort' => date("Hi", (filemtime("$cat_dir$file"))),
									'ul_rawtime_sort' => filemtime("$cat_dir$file"),
									'file_size_sort' => filesize("$media_dir$cat/$file"),
									'file_size_display' => round((filesize("$media_dir$cat/$file")/1024)),
									'archives_month' => date("m_F", (filemtime("$cat_dir$file"))),
									'archives_day' => date("d_l d", (filemtime("$cat_dir$file")))
									);
					}					 
				$filez_num[$cat] = count($filez[$cat]); 						// files count per category
				@ksort($filez[$cat], SORT_NUMERIC);
				$last_filez[$cat] = @end($filez[$cat]);							// latest file in each cat
				$last_datez[$cat] = date("m.d.y - h.i a", (filemtime("$media_dir$cat/$last_filez[$cat]")+($server_time*3600))); // latest date in each cat
				}
			}
			closedir($dh02);
		}
	}
}
closedir($dh01);

// ORGANIZATION OF FILES (sorting and filtering) //

// FILTER $main array and stores it in $filtered array
if (isset($c)) {																// filter by category
	foreach ($main as $key) {
		if ($key['category_sort'] == $c) {
			$filtered[] = $key;
		}
	}                                                                     
} elseif (isset($y)) {															// filter by year 
	foreach ($main as $key) {
		if ($key['ul_year_sort'] == $y) {
			$filtered[] = $key;
		}
	}
} elseif (isset($m)) {															// filter by month	  
	foreach ($main as $key) {
		if ($key['ul_month_sort'] == $m) {
			$filtered[] = $key;
		}
	}
} elseif (isset($d)) {															// filter by day
	foreach ($main as $key) {
		if ($key['ul_day_sort'] == $d) {
			$filtered[] = $key;
		}
	}
} else {
	$filtered = $main;
}

// rearrange $filtered array as columns to use with array_multisort
foreach ($filtered as $key => $row) {
   $file_id[$key] = $row['file_id'];
   $name_sort[$key] = $row['name_sort'];
   $category_sort[$key] = $row['category_sort'];
   $ul_year_sort[$key] = $row['ul_year_sort'];
   $ul_month_sort[$key] = $row['ul_month_sort'];
   $ul_day_sort[$key] = $row['ul_day_sort'];
   $ul_time_sort[$key] = $row['ul_time_sort'];
   $ul_rawtime_sort[$key] = $row['ul_rawtime_sort'];
   $file_size_sort[$key] = $row['file_size_sort'];
}

// SORT $filtered array

// default file sorting order (set in prefs)
if (!isset($s)) {
	switch ($default_sorting) {
		case 'chrono':
			$s = 'y';
		break;
		case 'rchrono':
			$s = 'y';
			$o = 'desc';
		break;
		case 'alpha':
			$s = 'n';	
		break;	
		case 'ralpha':
			$s = 'n';
			$o = 'desc';	
		break;
	}
}

// 1st conditional for sorting option - 2nd conditional for sorting order
// Add $filtered as the last parameter, to sort by the common key
if (count($filtered)>0) {                                                       // hides error message if no picture
    if ($s == 'i') {                                                            // sort by id
    	if ($o !== 'desc') {
    		array_multisort($file_id, SORT_ASC, $filtered);
    		} else {
    		array_multisort($file_id, SORT_DESC, $filtered);
    	}
    } else if ($s == 'n') {														// sort by name
    	if ($o !== 'desc') {
    		array_multisort($name_sort, SORT_ASC, $category_sort, SORT_ASC, $ul_rawtime_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    		} else {
    		array_multisort($name_sort, SORT_DESC, $category_sort, SORT_ASC, $ul_rawtime_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    	}	
    } else if ($s == 'c') {														// sort by category
    	if ($o !== 'desc') {
    		array_multisort($category_sort, SORT_ASC, $name_sort, SORT_ASC, $ul_rawtime_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    		} else {
    		array_multisort($category_sort, SORT_DESC, $name_sort, SORT_DESC, $ul_rawtime_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    	}
    } else if ($s == 'y') {														// sort by upload year
    	if ($o !== 'desc') {
    		array_multisort($ul_year_sort, SORT_ASC, $ul_rawtime_sort, SORT_ASC, $name_sort, SORT_ASC, $category_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    		} else {
    		array_multisort($ul_year_sort, SORT_DESC, $ul_rawtime_sort, SORT_DESC, $name_sort, SORT_ASC, $category_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    	}
    } else if ($s == 'm') {														// sort by upload month
    	if ($o !== 'desc') {
    		array_multisort($ul_month_sort, SORT_ASC, $ul_rawtime_sort, SORT_ASC, $name_sort, SORT_ASC, $category_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    		} else {
    		array_multisort($ul_month_sort, SORT_DESC, $ul_rawtime_sort, SORT_DESC, $name_sort, SORT_ASC, $category_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    	}
    } else if ($s == 'd') {														// sort by upload day
    	if ($o !== 'desc') {
    		array_multisort($ul_day_sort, SORT_ASC, $ul_rawtime_sort, SORT_ASC, $name_sort, SORT_ASC, $category_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    		} else {
    		array_multisort($ul_day_sort, SORT_DESC, $ul_rawtime_sort, SORT_DESC, $name_sort, SORT_ASC, $category_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    	}
    } else if ($s == 't') {														// sort by upload time
    	if ($o !== 'desc') {
    		array_multisort($ul_time_sort, SORT_ASC, $ul_rawtime_sort, SORT_ASC, $name_sort, SORT_ASC, $category_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    		} else {
    		array_multisort($ul_time_sort, SORT_DESC, $ul_rawtime_sort, SORT_DESC, $name_sort, SORT_ASC, $category_sort, SORT_ASC, $file_size_sort, SORT_ASC, $filtered);
    	}
    } else if ($s == 's') {														// sort by size
    	if ($o !== 'desc') {
    		array_multisort($file_size_sort, SORT_ASC, $name_sort, SORT_ASC, $category_sort, SORT_ASC, $ul_rawtime_sort, SORT_ASC, $filtered);
    		} else {
    		array_multisort($file_size_sort, SORT_DESC, $name_sort, SORT_ASC, $category_sort, SORT_ASC, $ul_rawtime_sort, SORT_ASC, $filtered);
    	}
    }
}

// CURRENT FILE RELATED VARIABLES //

// navigation and display info from ID retrieval
$first_file = $filtered[0];														// first file ID
$last_file = $filtered[((count($filtered)-1))];									// last file ID	
// default file ID value
if (!isset($id)) {
	if ($default_img == 'last') {
		$id = $last_file['file_id'];
	} else {
		$id = $first_file['file_id'];
	}	
}
for ($i=0; $i<count($filtered); $i++) {
	if ($filtered[$i]['file_id'] == $id) {
		$current_file = $filtered[$i];                                          // current file ID
		$previous_file = $filtered[$i-1];										// previous file ID
		$next_file = $filtered[$i+1];											// next file ID
		$file_count = $i+1;														// [info] file count (as in "2 of 10" kinda thing)
	}
}
$current_file_uri = $media_dir.$current_file['category'].'/'.$current_file['file_name'];
$current_file_dimensions = @getimagesize($current_file_uri);

// TAGS //

// $type available values -> 'name' 'link'
function gallery_name($type='name') {
	global $site_uri, $path2mg, $mg_name;
	echo(($type=='link' ? "<a href=\"$site_uri$path2mg\" title=\"$mg_name index\">" : '').$mg_name.($type=='link' ? '</a>' : ''));
}

// view switcher
function view_switcher($n01='list', $n02='thumbnails', $n03='file') {
	global $here, $view;
	echo("<li><a href=\"".my_QUERY_STRING()."&amp;view=list\" title=\"list view of files\"".($view == 'list' ? ' class="selected"' : '').">$n01</a></li>");
	echo("<li><a href=\"".my_QUERY_STRING()."&amp;view=thumb\" title=\"thumbnail view of files\"".($view == 'thumb' ? ' class="selected"' : '').">$n02</a></li>");
	echo("<li><a href=\"".my_QUERY_STRING()."&amp;view=file\" title=\"view currently selected file\"".($view == 'file' ? ' class="selected"' : '').">$n03</a></li>");
}

// style switcher
function style_switcher() {
	global $here, $theme, $current_theme, $total_templates, $templates_sorted, $templates_name, $c, $f, $x;
	if ($theme == 'multi') {
		for ($i=0; $i<$total_templates; $i++) {
			echo("<li><a href=\"".my_QUERY_STRING()."&amp;style=$templates_sorted[$i]\" title=\"switch to $templates_name[$i] CSS theme\"".($templates_sorted[$i] == $current_theme ? ' class="selected"' : '').">$templates_name[$i]</a></li>");
		}
	}
}

// list view
function list_view() {
	global $here, $filtered, $id, $y, $m, $d, $t, $c, $s, $o, $x;
	// for sorting and filtering of list view in table first row
	$list_view_first_row = array('n' => 'name',
								'c' => 'category',
								't' => 'time',
								'd' => 'day',
								'm' => 'month',
								'y' => 'year',
								's' => 'size');
	// first row with headers
	echo('<table><tr>');
	foreach ($list_view_first_row as $key => $value) {
		echo('<td '.($s == $key ? ($o == 'desc' ? 'class="selected_down"' : 'class="selected_up"') : '').'>');	// adds CSS class "selected" to cell of current file
		echo("<a href=\"$here?");
		// start custom QUERY_STRING (functionality needs to be different from my_QUERY_STRING function)
		if (isset($y) && $key!='y') {
			echo("y=$y&amp;");
		} elseif (isset($m) && $key!='m') {
			echo("m=$m&amp;");
		} elseif (isset($d) && $key!='d') {
			echo("d=$d&amp;");
		} elseif (isset($t) && $key!='t') {
			echo("t=$t&amp;");
		} elseif (isset($c) && $key!='c') {
			echo("c=$c&amp;");
		}
		// end custom QUERY_STRING
		echo("s=$key");
		echo($s!==$key || $o=='desc' ? '':'&amp;o=desc');
		echo($x=='1' ? '&amp;x=1':'');
		echo("\">$value</a></td>");
	}
	echo('</tr>');
	// file listing
	for ($i=0; $i<count($filtered); $i++) {
		echo('<tr>');
		echo(($filtered[$i]['file_id'] == $id ? '<td class="selected">' : '<td>').'<a href="'.my_QUERY_STRING('id', $filtered[$i]['file_id']).('&amp;view=file').'">'.$filtered[$i]['name_display'].'</a></td>');
		echo('<td><a href="'.$here.'?c='.$filtered[$i]['category_sort'].(isset($s) ? "&amp;s=$s":'').(isset($o) ? "&amp;o=desc":'').($x=='1' ? '&amp;x=1':'').('&amp;view=list').'">'.$filtered[$i]['category_display'].'</a></td>');
		echo('<td>'.$filtered[$i]['ul_time_display'].'</td>');
		echo('<td><a href="'.$here.'?d='.$filtered[$i]['ul_day_sort'].(isset($s) ? "&amp;s=$s":'').(isset($o) ? "&amp;o=desc":'').($x=='1' ? '&amp;x=1':'').('&amp;view=list').'">'.$filtered[$i]['ul_day_sort'].'</a></td>');
		echo('<td><a href="'.$here.'?m='.$filtered[$i]['ul_month_sort'].(isset($s) ? "&amp;s=$s":'').(isset($o) ? "&amp;o=desc":'').($x=='1' ? '&amp;x=1':'').('&amp;view=list').'">'.$filtered[$i]['ul_month_sort'].'</a></td>');
		echo('<td><a href="'.$here.'?y='.$filtered[$i]['ul_year_sort'].(isset($s) ? "&amp;s=$s":'').(isset($o) ? "&amp;o=desc":'').($x=='1' ? '&amp;x=1':'').('&amp;view=list').'">'.$filtered[$i]['ul_year_sort'].'</a></td>');
		echo('<td>'.($filtered[$i]['file_size_display']>1000 ? round(($filtered[$i]['file_size_display']/1000), 2).'MB':$filtered[$i]['file_size_display'].'KB').'</td>');
		echo('</tr>');
	}
	echo('</table>');
}

// $number of rows of thumbnail
// $number of colomns of thumbnail
// $name available values -> 'on' 'off'
// $size available values -> 'on' 'off'
// $dimensions available values -> 'on' 'off'
function thumbnail_table($rows='5', $columns='5', $name='off', $size='off', $dimensions='off', $empty_cell_content='') {
	global $here, $filtered, $media_dir, $cell_counter, $current_file, $p, $id;
	$page_size = $rows*$columns;												                // number of thumbnails per page
	if (!isset($p)) { $p = 1; }												                	// current thumbnail page displayed
	$cell_counter = ($p-1)*$page_size;										            		// first file to display on each page (must start at 0 on first thumbnail page)

	list($w, $h) = getimagesize($media_dir.$current_file['category'].'/'.$current_file['file_name']);
	
	echo('<table>');
	for ($i=0; $i<$rows; $i++) {
		if ($cell_counter<count($filtered)) {								        			// aborts row creation if no more thumbnails to display
			echo('<tr>');
			for ($ii=0; $ii<$columns; $ii++) {
			    echo('<td ');
				echo($filtered[$cell_counter]['file_id'] == $id ? ' id="selected_cell"' : '');	// adds CSS id "selected" to cell of current file
				echo($cell_counter+1>count($filtered) ? ' class="empty_cell"' : '');    	// adds CSS class "empty_cell" if no image left to display is last row
				echo('>');
				if ($cell_counter+1>count($filtered)) {									    	// add nbsp if if no more thumbnails to display
					echo($empty_cell_content);
				} else {
					echo('<a href="'.my_QUERY_STRING('id', $filtered[$cell_counter]['file_id']).('&amp;view=file').'"><img src="_mg/php/mg_thumbs.php?thumbcat='.$filtered[$cell_counter]['category'].'&amp;thumb='.$filtered[$cell_counter]['file_name'].'" alt="'.$filtered[$cell_counter]['file_name'].'" title="'.$filtered[$cell_counter]['name_display'].' - filed under: '.$filtered[$cell_counter][category_display].'"/></a>');
					// optional name, size, dimensions caption per thumbnail
					echo($name=='name' ? '<div class="cell_thumb_name">'.$filtered[$cell_counter]['name_display'].'</div>' : '');
					echo($size=='size' ? '<div class="cell_thumb_size">'.($filtered[$cell_counter]['file_size_display']>1000 ? round(($filtered[$cell_counter]['file_size_display']/1000), 2).'MB' : $filtered[$cell_counter]['file_size_display'].'KB').'</div>' : '');
					if ($dimensions=='dimensions') {
						list($temp_w, $temp_h) = getimagesize($media_dir.$filtered[$cell_counter]['category'].'/'.$filtered[$cell_counter]['file_name']);
						echo('<div class="cell_thumb_dimensions">'.$temp_w.'&#215;'.$temp_h.'</div>');
					}
				}
				$cell_counter++;														// goes trought $filtered array
				echo('</td>');
			}
			echo('</tr>');
		}
	}
	echo('</table>');
}

// $separator_01 is between thumnail numbers, $separator_02 is between pages numbers
function thumbnail_nav($rows='5', $columns='5', $separator_01='&ndash;', $separator_02=' | ') {
	global $here, $filtered, $page_size, $p;
	$page_size = $rows*$columns;												// number of thumbnails per page
	$pages_total = roundup(count($filtered)/$page_size);						// number of thumbnails pages
	$empty_cells = ($pages_total*$page_size) - count($filtered);				// number of empty table cells on last thumbnail page if any
	for ($i=1; $i<=$pages_total; $i++) {										// thumbnails page nav
		if ($i == $pages_total) {
			echo("<li><a href=\"".my_QUERY_STRING('p', $i).(!isset($p) ? "&amp;p=$i" : '').('&amp;view=thumb')."\">".($page_size*$i-$page_size+1).$separator_01.($page_size*$i-$empty_cells)."</a></li>");
		} else {                                 
			echo("<li><a href=\"".my_QUERY_STRING('p', $i).(!isset($p) ? "&amp;p=$i" : '').('&amp;view=thumb')."\">".($page_size*$i-$page_size+1).$separator_01.($page_size*$i)."</a></li>$separator_02");
		}
	}	
}

// Category list - extract categories from $main array and create list
// $type available values -> 'ul' 'ol'
function categories() {
	global $here, $main, $filtered, $current_file, $id, $c, $x;
	foreach ($main as $key => $row) {
		$cat_list[$key] = $row['category'];
	}
	$cat_list = array_unique($cat_list);
	natcasesort($cat_list);
	$cat_list = array_values($cat_list);
	for ($i=0; $i<count($cat_list); $i++) {
		$c_link = eregi_replace("[^[:alnum:]+]","_", strtolower($cat_list[$i]));
		$c_view = eregi_replace("[^[:alnum:]+]"," ",$cat_list[$i]);
		echo("<li><a href=\"$here?c=$c_link\"".($c_link==$c ? ' class="selected"' : '')." title=\"$c_view\">".$c_view."</a></li>");	// you could test $c_link == reset(explode('__',$id)) to show cat of file when $c is not set but it would be an awkward UI choice
	}	
}

// $sort available values -> 'cat' 'chrono'
function archives($default_sort='chrono') {
	global $main, $sort;
	if(!isset($sort)) {
		$sort = $default_sort;													// can override function default w/ function argument or query string
	}
	// create multidimensional archives array
	if ($sort=='cat') {
		foreach ($main as $k => $v) {
			$archives[$v['category_display']][$v['file_id']] = $v['name_display'];
		}
		// format array as list
		echo('<ul>');
		foreach ($archives as $categories => $that_category) {
			echo('<li><a href="#" title="show/hide">'.$categories.'</a><ul>');
			natcasesort($that_category);
			foreach ($that_category as $id => $name) {
				echo("<li><a href=\"index.php?id=$id&amp;view=file\" title=\"$name\">$name</a></li>");
			}
			echo('</ul></li>');
		}
		echo('</ul>');
	}
	if ($sort=='chrono') {
		foreach ($main as $k => $v) {
			// creates chrono multidimensional array from special archive keys in $main
			$archives[$v['ul_year_sort']][$v['archives_month']][$v['archives_day']][$v['file_id']] = $v['name_display'];
		}
		// sort and format array as unordered list
		echo('<ul>');
		ksort($archives);
		foreach ($archives as $year => $that_year) {
			echo('<li><a href="#" title="show/hide">'.$year.'</a><ul>');
			ksort($that_year);
			foreach ($that_year as $month => $that_month) {
				echo('<li><a href="#" title="show/hide">'.end(explode('_',$month)).'</a><ul>');
				ksort($that_month);
				foreach ($that_month as $day => $that_day) {
					echo('<li><a href="#" title="show/hide">'.end(explode('_',$day)).'</a><ul>');
					natcasesort($that_day);
					foreach ($that_day as $id => $name) {
						echo("<li><a href=\"index.php?id=$id&amp;view=file\" title=\"$name\">$name</a></li>");				
					}
					echo('</ul></li>');
				}
				echo('</ul></li>');
			}
			echo('</ul></li>');
		}
		echo('</ul>');	
	}
}

function nav_first($txt='first') {
	global $here, $first_file, $id;
	$first_name = $first_file['name_display'];
	$first_id = $first_file['file_id'];
	echo(($first_id!=$id ? "<a href=\"".my_QUERY_STRING('id', $first_id)."\" title=\"$first_name\">" : '').$txt.($first_id!=$id ? '</a>' : ''));
}

function nav_last($txt='last') {
	global $here, $last_file, $id;
	$last_name = $last_file['name_display'];
	$last_id = $last_file['file_id'];
	echo(($last_id!=$id ? "<a href=\"".my_QUERY_STRING('id', $last_id)."\" title=\"$last_name\">" : '').$txt.($last_id!=$id ? '</a>' : ''));
}

function nav_prev($txt='previous') {
	global $here, $previous_file;
	$prev = $previous_file['file_id'];
	$prev_name = $previous_file['name_display'];
	echo((isset($prev) ? "<a href=\"".my_QUERY_STRING('id', $prev)."\" title=\"$prev_name\">" : '').$txt.(isset($prev) ? '</a>' : ''));
}

function nav_next($txt='next') {
	global $here, $next_file;
	$next = $next_file['file_id'];
	$next_name = $next_file['name_display'];
	echo((isset($next) ? "<a href=\"".my_QUERY_STRING('id', $next)."\" title=\"$next_name\">" : '').$txt.(isset($next) ? '</a>' : ''));
}

// get a 'file #' of 'total file' count type thing
function current_file_count($separator=' of ') {
	echo($GLOBALS['file_count'].$separator.count($GLOBALS['filtered']));
}

// $click_img available values -> 'previous' 'next' 'none'
function current_file($click_img='previous') {
	global $here, $main, $filtered, $current_file, $current_file_uri, $current_file_dimensions, $previous_file, $next_file, $first_file, $last_file;
	// uses most of nav_prev, nav_next, and randomizer functions' code
	if ($click_img == 'previous') {
		$click = $previous_file['file_id'];
		$click_name = $previous_file['name_display'];
		if(is_null($click)) {													// loops back to end if no more file
			$click = $last_file['file_id'];
			$click_name = $last_file['name_display'];
		}		
	}	
	if ($click_img == 'next') {
		$click = $next_file['file_id'];
		$click_name = $next_file['name_display'];
		if(is_null($click)) {													// loops back to beginning if no more file
			$click = $first_file['file_id'];
			$click_name = $first_file['name_display'];
		}		
	}	
	echo((isset($click) ? "<a href=\"".my_QUERY_STRING('id', $click)."\" title=\"next: $click_name\">" : '').'<img src="'.$current_file_uri.'" '.$current_file_dimensions[3].' alt="a picture called '.$current_file['name_display'].' should be here..." />'.(isset($click) ? '</a>' : ''));
}

function current_file_name() {
	echo $GLOBALS['current_file']['name_display'];	
}

// $display available values -> 'name' 'link'
// $link_to available values -> 'thumb' 'list'
function current_file_cat($display='name', $link_to='thumb') {
	global $here, $filtered, $id, $c;
	for ($i=0; $i<count($filtered); $i++) {
		if ($filtered[$i]['file_id']==$id) {
			echo($display=='link' ? "<a href=\"$here?c=".$filtered[$i]['category_sort']."&amp;view=$link_to\" title=\"".$filtered[$i]['category_display'].'">'.$filtered[$i]['category_display'].'</a>' : $filtered[$i]['category_display']);	
		}	
	}
}

function current_file_date($format='m/d/y') {
	global $server_time, $current_file;
	echo(date("$format", ($current_file['ul_rawtime_sort']+$server_time*3600)));
}

function current_file_time($format='h:i a') {
	global $server_time, $current_file;
	echo(date("$format", ($current_file['ul_rawtime_sort']+$server_time*3600)));	
}

function current_file_size($kb='KB', $mb='MB') {
	global $current_file;
	echo ($current_file['file_size_display']>1000 ? round(($current_file['file_size_display']/1000), 2).$mb:$current_file['file_size_display'].$kb);	
}

function current_file_dimensions() {
	list($w, $h) = $GLOBALS['current_file_dimensions'];
	echo($w.'&#215;'.$h.' px');
}

// $name if you want a title for extended info
// $error to customize error message when EXIF info is unavailable
function current_file_info_extended($name, $error='<em>not available</em>') {
	global $current_file_uri, $extended_info, $x;
	if ($x==1 || $extended_info == 'yes') {
		if (isset($name)) { echo("<p>$name</p>"); }
		echo("<ul>");
		$result = read_exif_data_raw("$current_file_uri",0);

		echo ('<li>Camera Model: '.($result[IFD0][Model] ? trim($result[IFD0][Model]) : $error).'</li>');
		echo ('<li>Date and time: '.($result[SubIFD][DateTimeOriginal] ? trim($result[SubIFD][DateTimeOriginal]) : $error).'</li>');		
		echo ('<li>Shutter Speed: '.($result[SubIFD][ExposureTime] ? trim($result[SubIFD][ExposureTime]) : $error).'</li>');
		echo ('<li>Aperture: '.($result[SubIFD][FNumber] ? trim($result[SubIFD][FNumber]) : $error).'</li>');
		echo ('<li>Focal Length: '.($result[SubIFD][FocalLength] ? trim($result[SubIFD][FocalLength]) : $error).'</li>');
		echo ('<li>ISO Speed: '.($result[SubIFD][ISOSpeedRatings] ? trim($result[SubIFD][ISOSpeedRatings]) : $error).'</li>');
		echo ('<li>EV compensation: '.($result[SubIFD][ExposureBiasValue] ? trim($result[SubIFD][ExposureBiasValue]) : $error).'</li>');
		echo ('<li>Metering Mode: '.($result[SubIFD][MeteringMode] ? trim($result[SubIFD][MeteringMode]) : $error).'</li>');
		echo ('<li>Flash: '.($result[SubIFD][Flash] ? trim($result[SubIFD][Flash]) : $error).'</li>');
		echo('</ul>');
	}
}

function extended_info_switch($less='less info', $more='more info') {
	global $here, $extended_info, $c, $id, $x;	
	if ($extended_info !== yes) {
			echo("<a href=\"".my_QUERY_STRING('x').($x==1 ? '&amp;x=0':'&amp;x=1')."\" title=\"toggle extended info display\">".($x==1 ? "$less":"$more")."</a>");
	}
}

function current_file_caption() {
	global $media_dir, $current_file, $current_file_uri;
	$temp_txt_URI = $media_dir.$current_file['category'].'/'.eregi_replace("[^[:alnum:]+]","_",strtolower(reset(explode('.',$current_file['file_name'])))).'.txt';
	$size = getimagesize($current_file_uri, $info);								// extract iptc info from file	
	if (glob($temp_txt_URI)) {													// find if txt file w/ current media file name exists (PHP >= 4.3)
		@include($temp_txt_URI);												// include it in the page
	} else if (isset($info["APP13"])) {											// if not, check for IPTC info in the file
		$iptc = iptcparse($info["APP13"]);
		$desc_f_iptc = $iptc["2#120"][0];										// that's the IPTC array element corresponding to "caption/abstract" in IPTC block
		echo("$desc_f_iptc");													// and echo it on the page
	}
}

// $display_info available values -> title, caption, event, location, city, state, country, genre, keyword, category, author, copyright, status
// $separator is used if $display_info echoes a list (i.e. keywords or categories)
function my_iptc($display_info='title', $not_available='not available', $separator='') {
	global $media_dir, $current_file, $current_file_uri;
	$temp_txt_URI = $media_dir.$current_file['category'].'/'.eregi_replace("[^[:alnum:]+]","_",strtolower(reset(explode('.',$current_file['file_name'])))).'.txt';
	$size = @getimagesize($current_file_uri, $info);
	if (isset($info["APP13"])) {												// check for IPTC info in the file
		$iptc = iptcparse($info["APP13"]);										// parse raw IPTC blacks
	}
	switch ($display_info) {
		case 'title':															// set to file name if IPTC not available
			$iptc_info = $iptc['2#105'][0];
			(isset($iptc_info) ? $iptc_info : $iptc_info=$current_file['name_display']);
		break;
		case 'caption':
			$iptc_info = $iptc['2#120'][0];
		break;
		case 'event':
			$iptc_info = $iptc['2#022'][0];
		break;
		case 'location':
			$iptc_info = $iptc['2#092'][0];
		break;
		case 'city':
			$iptc_info = $iptc['2#090'][0];
		break;
		case 'state':
			$iptc_info = $iptc['2#095'][0];
		break;
		case 'country':
			$iptc_info = $iptc['2#101'][0];
		break;
		case 'genre':
			$iptc_info = $iptc['2#015'][0];
		break;
		case 'keyword':															// outputs unordered list (ul) if more than 1 keyword is in IPTC block
			if (count($iptc['2#025'])>1) {
				for ($i=0; $i<count($iptc['2#025']) ; $i++) {
					$iptc_info = $iptc_info.'<li>'.$iptc['2#025'][$i].$separator.'</li>';
				}
				$iptc_info = '<ul>'.$iptc_info.'</ul>';
			} else {
				$iptc_info = $iptc['2#025'][0];
			}
		break;
		case 'category':														// outputs unordered list (ul) if more than 1 category is in IPTC block
			if (count($iptc['2#020'])>1) {
				for ($i=0; $i<count($iptc['2#020']) ; $i++) {
					$iptc_info = $iptc_info.'<li>'.$iptc['2#020'][$i].$separator.'</li>';
				}
				$iptc_info = '<ul>'.$iptc_info.'</ul>';
			} else {
				$iptc_info = $iptc['2#020'][0];
			}
		break;
		case 'author':
			$iptc_info = $iptc['2#080'][0];
		break;
		case 'copyright':
			$iptc_info = $iptc['2#116'][0];
		break;
		case 'status':
			$iptc_info = $iptc['2#007'][0];
		break;
	}
	echo(!isset($iptc_info) ? "$not_available" : "$iptc_info$separator");					// if you wanna customize error message for unavailable IPTC info, that's where it's at
}

function last_update_date($format='m/d/y') {
	global $main, $ul_rawtime_sort, $server_time;
	for ($i=0; $i<count($main); $i++) {
		$updates[$i] = $main[$i]['ul_rawtime_sort'];
	}
	rsort($updates, SORT_NUMERIC);
	$last_update = date($format, ($updates[0]+$server_time*3600));
	echo("$last_update");
}

function last_update_time($format='h:i a') {
	global $main, $ul_rawtime_sort, $server_time;
	for ($i=0; $i<count($main); $i++) {
		$updates[$i] = $main[$i]['ul_rawtime_sort'];
	}
	rsort($updates, SORT_NUMERIC);
	$last_update = date($format, ($updates[0]+$server_time*3600));
	echo("$last_update");
}

// $scope available values -> 'global' 'local'
function randomizer($text='random', $scope='local') {
	global $here, $main, $filtered;
	if ($scope=='global') {
		$rand = $main[array_rand($main)]['file_id'];
	} else {
		$rand = $filtered[array_rand($filtered)]['file_id'];
	}
	echo("<a href=\"".($scope=='global' ? "$here?id=$rand" : my_QUERY_STRING('id', $rand))."\" title=\"view random file\">$text</a>");
}

function slideshow() {
	global $slides, $slides_speed, $here, $main, $filtered, $previous_file, $next_file, $first_file, $last_file;
	global $slide_type, $slide_scope;											// settings in pref instead of function parameter because function has to be on top of index.php since it sends a header
	if ($slides=='on') {
		if($slide_type=='forward') {
			if(is_null($next_file)) {											// loops back to beginning if no more file
				$next_slide = $first_file['file_id'];
			} else {
				$next_slide = $next_file['file_id'];
			}	
		}
		if($slide_type=='backward') {
			if(is_null($previous_file)) {										// loops back to end if no more file
				$next_slide = $last_file['file_id'];
			} else {
				$next_slide = $previous_file['file_id'];
			}
		}
		if($slide_type=='random') {
			$next_slide = $filtered[array_rand($filtered)]['file_id'];
		}
		if($slide_scope=='global') {
			echo(header("Refresh: $slides_speed; URL=./$here?id=$next_slide&slides"));
		} else {
			echo(header("Refresh: $slides_speed; URL=./".my_QUERY_STRING('id', $next_slide, '&'
			 
			)));
		}
	}
}

function slideshow_switch($start='start', $stop='stop') {
	global $slides, $here, $id;
	echo("<a href=\"".my_QUERY_STRING('slides').($slides=='on' ? '&amp;slides=off':'&amp;slides=on')."\" title=\"slide show\">".($slides=='on' ? "$stop":"$start")."</a>");
}

// $type available values -> 'listed' 'main' - $style available values -> 'text' 'button'
function photoblogs($type='listed', $style='button') {
	if ($type == 'main') {
		echo('<a href="http://www.photoblogs.org/" title="Photoblogs.org">'.($style == 'text' ? 'photoblogs.org' : '<img src="./_mg/assets/photoblogs_main.gif" alt="Photoblogs.org" />').'</a>');
 	} else if ($type == 'listed') {
 		echo('<a href="http://www.photoblogs.org/profile/" title="view my profile/add me to your favorites on photoblogs.org">'.($style == 'text' ? 'photoblogs.org listed' : '<img src="./_mg/assets/photoblogs_listed.gif" alt="view my profile/add me to your favorites on photoblogs.org" />').'</a>');

 	}
}

function mg_powered() {
	global $mg_version;
	echo("powered by <a href=\"http://minimalgallery.net/home\" title=\"minimal Gallery web site\">minimal Gallery $mg_version</a>");
}

function validation() {
	echo("valid <a href=\"http://validator.w3.org/check/referer\" title=\"valid XHTML 1.0 strict\">xhtml</a> &amp; <a href=\"http://jigsaw.w3.org/css-validator/check/referer\" title=\"valid CSS 2.0\">css</a>");
}

// rounds any number up to next integer (used for $page_total of thumbnail viewer)
function roundup($n) {
	if (round($n)<$n) {
		$n = round($n)+1;
	} else { 
		$n = round($n);
	}
	return $n;
}

?>
